/**
 * appendix/user_data (free): account balance.
 * Docs: https://docs.dataforseo.com/v3/appendix/user_data/
 */
import { assertTaskOk, dfsRequest } from "../client";

export function mapUserData(task: { result?: { money?: { balance?: number; total?: number } }[] | null }) {
  const m = task.result?.[0]?.money;
  return {
    balanceUsd: typeof m?.balance === "number" ? m.balance : null,
    totalDepositedUsd: typeof m?.total === "number" ? m.total : null,
  };
}

export async function getBalance() {
  const env = await dfsRequest<{ money?: { balance?: number; total?: number } }>("GET", "/v3/appendix/user_data");
  const t = env.tasks?.[0];
  assertTaskOk(t);
  return mapUserData(t);
}
