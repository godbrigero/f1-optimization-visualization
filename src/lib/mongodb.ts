import "server-only";

import { Db, MongoClient } from "mongodb";
import { getMongoEnv } from "@/lib/env";

type MongoConnection = {
  client: MongoClient;
  db: Db;
};

declare global {
  var mongoConnectionPromise: Promise<MongoConnection> | undefined;
}

async function createMongoConnection(): Promise<MongoConnection> {
  const { uri, dbName } = getMongoEnv();
  const client = new MongoClient(uri);

  await client.connect();

  return {
    client,
    db: client.db(dbName),
  };
}

export function getMongoConnection(): Promise<MongoConnection> {
  if (!globalThis.mongoConnectionPromise) {
    globalThis.mongoConnectionPromise = createMongoConnection();
  }

  return globalThis.mongoConnectionPromise;
}

export async function getDb(): Promise<Db> {
  const { db } = await getMongoConnection();
  return db;
}
