const express = require("express");
const {
  DynamoDBClient,
  CreateTableCommand,
  ResourceInUseException,
} = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const app = express();
const PORT = process.env.PORT || 3000;
const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_TABLE || "eb-app-visits";
const APP_VERSION = process.env.APP_VERSION || "1.0.0";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function ensureTable() {
  const client = new DynamoDBClient({ region: REGION });
  try {
    await client.send(
      new CreateTableCommand({
        TableName: TABLE,
        KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
        AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
        BillingMode: "PAY_PER_REQUEST",
      })
    );
    console.log(`Table "${TABLE}" created.`);
  } catch (err) {
    if (err.name !== "ResourceInUseException") throw err;
  }
}

async function incrementVisits() {
  const result = await dynamo.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: "visits" },
      UpdateExpression: "ADD #count :inc",
      ExpressionAttributeNames: { "#count": "count" },
      ExpressionAttributeValues: { ":inc": 1 },
      ReturnValues: "ALL_NEW",
    })
  );
  return result.Attributes.count;
}

async function getVisits() {
  const result = await dynamo.send(
    new GetCommand({ TableName: TABLE, Key: { pk: "visits" } })
  );
  return result.Item?.count ?? 0;
}

app.get("/", async (req, res) => {
  try {
    const visits = await incrementVisits();
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>EB Node App</title>
          <style>
            body { font-family: sans-serif; max-width: 600px; margin: 60px auto; padding: 0 20px; }
            .badge { display: inline-block; background: #232f3e; color: #ff9900; padding: 4px 12px; border-radius: 4px; font-size: 0.85rem; }
            h1 { color: #232f3e; }
            .stat { font-size: 2rem; font-weight: bold; color: #ff9900; }
          </style>
        </head>
        <body>
          <span class="badge">AWS Elastic Beanstalk</span>
          <h1>Deployment Successful</h1>
          <p>App Version: <strong>v${APP_VERSION}</strong></p>
          <p>Environment: <strong>${process.env.ENVIRONMENT_NAME || "production"}</strong></p>
          <p>Region: <strong>${REGION}</strong></p>
          <hr/>
          <p>Total Visits (via DynamoDB)</p>
          <div class="stat">${visits}</div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("DynamoDB error:", err.message);
    res.status(500).send(`Error connecting to DynamoDB: ${err.message}`);
  }
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", version: APP_VERSION });
});

app.get("/visits", async (req, res) => {
  try {
    const count = await getVisits();
    res.json({ visits: count, version: APP_VERSION });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

ensureTable()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to ensure DynamoDB table:", err.message);
    process.exit(1);
  });
