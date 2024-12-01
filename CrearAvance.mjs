import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
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

    const { tenant_id: tokenTenantId } = tokenData;

    // Parsear el cuerpo de la solicitud
    const body =
      typeof event.body === "string" ? JSON.parse(event.body) : event.body;

    const {
      tenant_id,
      user_id,
      level,
      course_id,
      course_name,
      credits,
      grade,
      status,
      period,
    } = body;

    // Validar parámetros requeridos
    if (
      !tenant_id ||
      !user_id ||
      !level ||
      !course_id ||
      !course_name ||
      !credits ||
      grade === undefined ||
      !status ||
      !period
    ) {
      console.error("Error: Faltan datos requeridos:", body);
      return {
        statusCode: 400,
        body: {
          error:
            "Faltan datos requeridos: tenant_id, user_id, level, course_id, course_name, credits, grade, status o period.",
        },
      };
    }

    // Validar que el tenant_id del token coincide con el proporcionado
    if (tenant_id !== tokenTenantId) {
      console.error(
        `Error: tenant_id del token (${tokenTenantId}) no coincide con el tenant_id proporcionado (${tenant_id}).`
      );
      return {
        statusCode: 403,
        body: {
          error: "No tienes permiso para registrar avances en este tenant.",
        },
      };
    }

    // Crear el avance académico en DynamoDB
    const advanceData = {
      "tenant_id#user_id": `${tenant_id}#${user_id}`, // Clave de partición
      "level#curso_id": `${level}#${course_id}`, // Corrige aquí el nombre de la clave
      CourseID: course_id,
      CourseName: course_name,
      Credits: credits,
      Grade: grade,
      Status: status,
      Period: period,
      Level: level,
    };

    const putParams = {
      TableName: "t_avance_academico", // Nombre de la tabla
      Item: advanceData,
      ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
      ExpressionAttributeNames: {
        "#pk": "tenant_id#user_id",
        "#sk": "level#curso_id", // Corrige aquí también
      },
    };

    try {
      console.log("Guardando en DynamoDB:", putParams);
      await docClient.send(new PutCommand(putParams));
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        console.error("Error: El avance ya existe en la base de datos.");
        return {
          statusCode: 409,
          body: { error: "El avance ya existe en la base de datos." },
        };
      }
      console.error("Error al guardar en DynamoDB:", err.message || err);
      return {
        statusCode: 500,
        body: { error: "Error guardando el avance académico." },
      };
    }

    return {
      statusCode: 201,
      body: { message: "Avance académico registrado exitosamente." },
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
