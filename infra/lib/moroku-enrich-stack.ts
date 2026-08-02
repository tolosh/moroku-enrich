/**
 * Moroku Enrich — the whole service as one CDK stack (spec §6).
 *
 * Boring on purpose, near-zero idle cost. HTTP API v2 + Lambda authorizer
 * (bearer key → SHA-256 lookup in `tenants`), the service Lambdas, all six
 * DynamoDB tables from spec §5, the unknown-merchant SQS queue + DLQ, a
 * CloudWatch dashboard + fallback-rate alarm, and SSM config under
 * `/moroku-enrich/<stage>/*`. Strictly self-contained (decision §9.2): own IAM
 * roles, least privilege, no reliance on pre-existing resources; everything is
 * tagged `project:moroku-enrich` + `stage:<stage>` from bin/moroku-enrich.ts.
 */
import * as path from "node:path";
import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import {
  HttpApi,
  HttpMethod,
  HttpNoneAuthorizer,
  CfnStage,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  HttpLambdaAuthorizer,
  HttpLambdaResponseType,
} from "aws-cdk-lib/aws-apigatewayv2-authorizers";

export interface MorokuEnrichStackProps extends StackProps {
  /** Deployment stage — `dev` today, `prod` later via CDK stages (spec §6). */
  readonly stage: string;
}

/** Custom-metric namespace handlers emit to (EMF). Dashboards + alarm read it. */
const METRIC_NAMESPACE = "MorokuEnrich";
/** Fallback-rate alarm threshold, percent (spec §6: alarm on fallback rate > 15%). */
const FALLBACK_ALARM_PCT = 15;

export class MorokuEnrichStack extends Stack {
  constructor(scope: Construct, id: string, props: MorokuEnrichStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const isProd = stage === "prod";
    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const prefix = `moroku-enrich-${stage}`;
    const servicesRoot = path.join(__dirname, "..", "..", "services");
    const depsLockFilePath = path.join(__dirname, "..", "..", "package-lock.json");

    // ---------------------------------------------------------------------
    // DynamoDB tables (spec §5). On-demand billing; PITR only in prod.
    // ---------------------------------------------------------------------
    const table = (
      cid: string,
      name: string,
      partitionKey: string,
      sortKey?: string,
    ) =>
      new dynamodb.Table(this, cid, {
        tableName: `${prefix}-${name}`,
        partitionKey: { name: partitionKey, type: dynamodb.AttributeType.STRING },
        ...(sortKey
          ? { sortKey: { name: sortKey, type: dynamodb.AttributeType.STRING } }
          : {}),
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy,
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
      });

    // Authorizer lookup table. PK = SHA-256 of the bearer key (never raw keys).
    const tenants = table("TenantsTable", "tenants", "key_hash");
    tenants.addGlobalSecondaryIndex({
      indexName: "tenant_id-index",
      partitionKey: { name: "tenant_id", type: dynamodb.AttributeType.STRING },
    });

    const merchantsGlobal = table("MerchantsGlobalTable", "merchants-global", "match_key");
    // Overloaded single-table: `pk`=owner scope, `sk`=match_key (or TENANT#match_key).
    const overrides = table("OverridesTable", "overrides", "pk", "sk");
    // Append-only. `sk` value is `ts#uuid`.
    const correctionsLog = table("CorrectionsLogTable", "corrections-log", "tenant", "sk");
    // `cache_key` value is `match_key#prompt_version`.
    const llmCache = table("LlmCacheTable", "llm-cache", "cache_key");
    const promotionQueue = table("PromotionQueueTable", "promotion-queue", "match_key");

    // ---------------------------------------------------------------------
    // SQS — unknown-merchant queue + DLQ (spec §4 LLM tier, §6).
    // ---------------------------------------------------------------------
    const unknownMerchantDlq = new sqs.Queue(this, "UnknownMerchantDlq", {
      queueName: `${prefix}-unknown-merchant-dlq`,
      retentionPeriod: Duration.days(14),
    });
    const unknownMerchantQueue = new sqs.Queue(this, "UnknownMerchantQueue", {
      queueName: `${prefix}-unknown-merchant`,
      // Must be >= the classifier's timeout; 2x for headroom.
      visibilityTimeout: Duration.seconds(120),
      deadLetterQueue: { queue: unknownMerchantDlq, maxReceiveCount: 5 },
    });

    // ---------------------------------------------------------------------
    // SSM config under /moroku-enrich/<stage>/config/* (spec §6: config in SSM).
    // ---------------------------------------------------------------------
    const ssmBase = `/moroku-enrich/${stage}/config`;
    const configValues: Record<string, string> = {
      "llm-tier-enabled": "false", // classifier stub off until phase 2
      "prompt-version": "1", // llm_cache key component
      "low-confidence-threshold": "0.8", // < this → flags:["low_confidence"] + confident_pct cut
      "llm-trust-threshold": "0.6", // model confidence below this is not trusted (spec §4)
      "fallback-alarm-threshold-pct": String(FALLBACK_ALARM_PCT),
      "tenant-promotion-min-users": "3", // tenant scope at >= 3 agreeing users (spec §3.2)
      "global-promotion-min-tenants": "2",
      "global-promotion-min-users": "5",
    };
    const configParams = Object.fromEntries(
      Object.entries(configValues).map(([k, v]) => [
        k,
        new ssm.StringParameter(this, `Cfg-${k}`, {
          parameterName: `${ssmBase}/${k}`,
          stringValue: v,
          tier: ssm.ParameterTier.STANDARD,
        }),
      ]),
    ) as Record<string, ssm.StringParameter>;

    // ---------------------------------------------------------------------
    // Lambdas (NodejsFunction, nodejs22.x, arm64, esbuild). Least-privilege IAM.
    // ---------------------------------------------------------------------
    const commonEnv: Record<string, string> = {
      STAGE: stage,
      SSM_CONFIG_PREFIX: ssmBase,
      TABLE_TENANTS: tenants.tableName,
      TABLE_MERCHANTS_GLOBAL: merchantsGlobal.tableName,
      TABLE_OVERRIDES: overrides.tableName,
      TABLE_CORRECTIONS_LOG: correctionsLog.tableName,
      TABLE_LLM_CACHE: llmCache.tableName,
      TABLE_PROMOTION_QUEUE: promotionQueue.tableName,
      UNKNOWN_MERCHANT_QUEUE_URL: unknownMerchantQueue.queueUrl,
      METRIC_NAMESPACE,
      // Config mirrored to env for hot-path reads; SSM remains the source of truth.
      LLM_TIER_ENABLED: configValues["llm-tier-enabled"]!,
      PROMPT_VERSION: configValues["prompt-version"]!,
      LOW_CONFIDENCE_THRESHOLD: configValues["low-confidence-threshold"]!,
      LLM_TRUST_THRESHOLD: configValues["llm-trust-threshold"]!,
      NODE_OPTIONS: "--enable-source-maps",
    };

    const makeFn = (
      cid: string,
      service: string,
      opts: {
        memory?: number;
        timeout?: Duration;
        env?: Record<string, string>;
      } = {},
    ) =>
      new NodejsFunction(this, cid, {
        functionName: `${prefix}-${service}`,
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        entry: path.join(servicesRoot, service, "src", "handler.ts"),
        handler: "handler",
        memorySize: opts.memory ?? 512,
        timeout: opts.timeout ?? Duration.seconds(30),
        environment: { ...commonEnv, ...(opts.env ?? {}) },
        depsLockFilePath,
        bundling: {
          minify: true,
          sourceMap: true,
          target: "node22",
          format: OutputFormat.CJS,
          // aws-sdk v3 is provided by the nodejs22.x runtime — don't bundle it.
          externalModules: ["@aws-sdk/*"],
        },
      });

    // --- Authorizer: bearer key → SHA-256 → tenants lookup, tenant context out.
    const authorizerFn = makeFn("AuthorizerFn", "authorizer", {
      memory: 256,
      timeout: Duration.seconds(10),
    });
    tenants.grantReadData(authorizerFn);
    // Soft-quota counters live in the tenants table; the authorizer updates them.
    tenants.grantWriteData(authorizerFn);

    // --- categorise (sync): reads lookup tiers, enqueues unknown merchants.
    const categoriseFn = makeFn("CategoriseFn", "categorise");
    merchantsGlobal.grantReadData(categoriseFn);
    overrides.grantReadData(categoriseFn);
    llmCache.grantReadData(categoriseFn);
    unknownMerchantQueue.grantSendMessages(categoriseFn);

    // --- corrections (sync): writes overrides, appends log, queues promotions.
    const correctionsFn = makeFn("CorrectionsFn", "corrections");
    overrides.grantReadWriteData(correctionsFn);
    correctionsLog.grantWriteData(correctionsFn);
    merchantsGlobal.grantReadData(correctionsFn);
    promotionQueue.grantReadWriteData(correctionsFn);

    // --- read: taxonomy / merchants / overrides / health.
    const readFn = makeFn("ReadFn", "read");
    merchantsGlobal.grantReadData(readFn);
    overrides.grantReadWriteData(readFn); // DELETE /v1/overrides writes a tombstone
    correctionsLog.grantWriteData(readFn); // revocations append to the log (spec §3.3)

    // --- classifier (SQS worker): one-time Bedrock Haiku classification → cache.
    const classifierFn = makeFn("ClassifierFn", "classifier", {
      memory: 512,
      timeout: Duration.seconds(60),
    });
    llmCache.grantReadWriteData(classifierFn);
    merchantsGlobal.grantReadData(classifierFn);
    correctionsLog.grantReadData(classifierFn); // few-shot examples from corrections
    classifierFn.addEventSource(
      new SqsEventSource(unknownMerchantQueue, { batchSize: 10, reportBatchItemFailures: true }),
    );
    // Bedrock Haiku (+ cross-region inference fallback). Scoped to Anthropic models.
    classifierFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:*::foundation-model/anthropic.claude-3-haiku*`,
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      }),
    );

    // --- promotion worker: corroborate corrections → merchants_global (guarded).
    const promotionFn = makeFn("PromotionFn", "promotion", {
      memory: 512,
      timeout: Duration.seconds(60),
    });
    correctionsLog.grantReadData(promotionFn);
    promotionQueue.grantReadWriteData(promotionFn);
    merchantsGlobal.grantReadWriteData(promotionFn);
    // Runs periodically to sweep pending promotions (dev cadence; tune later).
    new events.Rule(this, "PromotionSchedule", {
      ruleName: `${prefix}-promotion-sweep`,
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(promotionFn)],
    });

    // Grant SSM config read to every function (source of truth is SSM).
    const allFns = [
      authorizerFn,
      categoriseFn,
      correctionsFn,
      readFn,
      classifierFn,
      promotionFn,
    ];
    for (const fn of allFns) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["ssm:GetParameter", "ssm:GetParametersByPath"],
          resources: [
            `arn:aws:ssm:${this.region}:${this.account}:parameter${ssmBase}`,
            `arn:aws:ssm:${this.region}:${this.account}:parameter${ssmBase}/*`,
          ],
        }),
      );
      // Emit custom metrics (EMF) — no resource-level scoping available.
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["cloudwatch:PutMetricData"],
          resources: ["*"],
          conditions: { StringEquals: { "cloudwatch:namespace": METRIC_NAMESPACE } },
        }),
      );
    }
    // Keep the params reference used (also documents intent for future SSM reads).
    void configParams;

    // ---------------------------------------------------------------------
    // HTTP API v2 + Lambda authorizer (spec §3, §6). Stage-level throttling as
    // the hard backstop; per-tenant soft quotas live in the authorizer.
    // ---------------------------------------------------------------------
    const authorizer = new HttpLambdaAuthorizer("BearerAuthorizer", authorizerFn, {
      authorizerName: `${prefix}-bearer`,
      identitySource: ["$request.header.Authorization"],
      responseTypes: [HttpLambdaResponseType.SIMPLE],
      resultsCacheTtl: Duration.minutes(5), // ~5 min identity-based cache (spec §3)
    });

    const api = new HttpApi(this, "HttpApi", {
      apiName: `${prefix}-api`,
      description: `Moroku Enrich ${stage} HTTP API`,
      defaultAuthorizer: authorizer,
    });

    const integ = (cid: string, fn: lambda.IFunction) =>
      new HttpLambdaIntegration(cid, fn);

    api.addRoutes({
      path: "/v1/categorise",
      methods: [HttpMethod.POST],
      integration: integ("CategoriseInteg", categoriseFn),
    });
    api.addRoutes({
      path: "/v1/corrections",
      methods: [HttpMethod.POST],
      integration: integ("CorrectionsInteg", correctionsFn),
    });
    api.addRoutes({
      path: "/v1/taxonomy",
      methods: [HttpMethod.GET],
      integration: integ("TaxonomyInteg", readFn),
    });
    api.addRoutes({
      path: "/v1/merchants/{match_key}",
      methods: [HttpMethod.GET],
      integration: integ("MerchantsInteg", readFn),
    });
    api.addRoutes({
      path: "/v1/overrides",
      methods: [HttpMethod.GET],
      integration: integ("OverridesInteg", readFn),
    });
    api.addRoutes({
      path: "/v1/overrides/{id}",
      methods: [HttpMethod.DELETE],
      integration: integ("OverrideDeleteInteg", readFn),
    });
    // Health is liveness — unauthenticated so monitors don't need a key.
    api.addRoutes({
      path: "/v1/health",
      methods: [HttpMethod.GET],
      integration: integ("HealthInteg", readFn),
      authorizer: new HttpNoneAuthorizer(),
    });

    // Stage-level throttling backstop on the auto-created $default stage.
    const defaultStage = api.defaultStage?.node.defaultChild as CfnStage;
    defaultStage.defaultRouteSettings = {
      throttlingBurstLimit: 200,
      throttlingRateLimit: 100,
    };

    // ---------------------------------------------------------------------
    // CloudWatch — dashboard + fallback-rate alarm (spec §6).
    // ---------------------------------------------------------------------
    const dims = { Stage: stage };
    const metric = (metricName: string, statistic: string) =>
      new cloudwatch.Metric({
        namespace: METRIC_NAMESPACE,
        metricName,
        dimensionsMap: dims,
        statistic,
        period: Duration.minutes(5),
      });

    const fallbackRate = metric("FallbackRate", "Average");
    const fallbackAlarm = new cloudwatch.Alarm(this, "FallbackRateAlarm", {
      alarmName: `${prefix}-fallback-rate-high`,
      alarmDescription: `Fallback rate over ${FALLBACK_ALARM_PCT}% — unknown-merchant coverage is degrading (spec §6).`,
      metric: fallbackRate,
      threshold: FALLBACK_ALARM_PCT,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const dashboard = new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: `${prefix}`,
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Confident %",
        left: [metric("ConfidentPct", "Average")],
        width: 12,
        leftYAxis: { min: 0, max: 100 },
      }),
      new cloudwatch.GraphWidget({
        title: "Fallback rate %",
        left: [fallbackRate],
        leftAnnotations: [{ value: FALLBACK_ALARM_PCT, label: "alarm" }],
        width: 12,
        leftYAxis: { min: 0, max: 100 },
      }),
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Source mix (results by tier)",
        left: [
          "exclusion",
          "user_override",
          "tenant_override",
          "mcc",
          "dictionary",
          "rules",
          "llm_cache",
          "fallback",
        ].map(
          (source) =>
            new cloudwatch.Metric({
              namespace: METRIC_NAMESPACE,
              metricName: "SourceCount",
              dimensionsMap: { ...dims, Source: source },
              statistic: "Sum",
              period: Duration.minutes(5),
              label: source,
            }),
        ),
        stacked: true,
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "Correction volume",
        left: [metric("CorrectionVolume", "Sum")],
        width: 12,
      }),
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Unknown-merchant queue depth",
        left: [
          unknownMerchantQueue.metricApproximateNumberOfMessagesVisible(),
          unknownMerchantDlq.metricApproximateNumberOfMessagesVisible({ label: "DLQ" }),
        ],
        width: 12,
      }),
      new cloudwatch.AlarmWidget({ title: "Fallback-rate alarm", alarm: fallbackAlarm, width: 12 }),
    );

    // ---------------------------------------------------------------------
    // Outputs.
    // ---------------------------------------------------------------------
    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint, description: "HTTP API base URL" });
    new CfnOutput(this, "UnknownMerchantQueueUrl", { value: unknownMerchantQueue.queueUrl });
    new CfnOutput(this, "DashboardName", { value: dashboard.dashboardName });
  }
}
