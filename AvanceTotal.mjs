import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({});

const ADVANCE_TABLE = "t_avance_academico";

// Helper para validar el token usando la función Lambda
async function validateToken(token) {
  const params = {
    FunctionName: "ValidarTokenAcceso",
    Payload: JSON.stringify({ token }),
  };

  try {
    const result = await lambdaClient.send(new InvokeCommand(params));
    const response = JSON.parse(new TextDecoder("utf-8").decode(result.Payload));

    if (response.statusCode !== 200) {
      const errorBody =
        typeof response.body === "string"
          ? JSON.parse(response.body)
          : response.body;

      throw new Error(errorBody.error || "Token inválido o expirado.");
    }

    return typeof response.body === "string"
      ? JSON.parse(response.body)
      : response.body;
  } catch (err) {
    console.error("Error en validateToken:", err.message || err);
    throw new Error(`Error validando el token: ${err.message}`);
  }
}

export const handler = async (event) => {
  try {
    // Validar el token desde el encabezado
    const token = event.headers.Authorization?.replace("Bearer ", "");
    if (!token) {
      console.error("Error: Token no proporcionado.");
      return {
        statusCode: 401,
        body: { error: "Token de autorización no proporcionado." },
      };
    }

    let tokenData;
    try {
      tokenData = await validateToken(token);
    } catch (err) {
      console.error("Error validando el token:", err.message);
      return {
        statusCode: 401,
        body: { error: err.message },
      };
    }

    const { tenant_id, user_id } = tokenData;

    // Consultar los avances académicos en DynamoDB
    const queryParams = {
      TableName: ADVANCE_TABLE,
      KeyConditionExpression: "#partitionKey = :partitionKey",
      ExpressionAttributeNames: {
        "#partitionKey": "tenant_id#user_id",
      },
      ExpressionAttributeValues: {
        ":partitionKey": `${tenant_id}#${user_id}`,
      },
    };

    let result;
    try {
      result = await docClient.send(new QueryCommand(queryParams));
    } catch (err) {
      console.error("Error al consultar avances académicos:", err.message || err);
      return {
        statusCode: 500,
        body: { error: "Error al consultar avances académicos." },
      };
    }

    const avances = result.Items || [];

    // Agrupar los avances por nivel
    const nivelesAgrupados = {};
    for (let i = 1; i <= 10; i++) {
      nivelesAgrupados[i] = [];
    }

    avances.forEach((avance) => {
      const level = avance.Level;
      nivelesAgrupados[level].push({
        course_id: avance.CourseID,
        course_name: avance.CourseName,
        credits: avance.Credits,
        grade: avance.Grade,
        status: avance.Status,
        period: avance.Period,
      });
    });

    // Añadir un mensaje para niveles sin avances
    for (const level in nivelesAgrupados) {
      if (nivelesAgrupados[level].length === 0) {
        nivelesAgrupados[level] = "El estudiante no ah llevado un curso de este nivel.";
      }
    }

    return {
      statusCode: 200,
      body: {
        tenant_id,
        user_id,
        academic_progress: nivelesAgrupados,
      },
    };
  } catch (err) {
    console.error("Error detectado en handler:", err.message || err);
    return {
      statusCode: 500,
      body: {
        error: err.message || "Error interno.",
      },
    };
  }
};
