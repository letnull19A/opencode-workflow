import type { CommandResult, ICommand, IServiceConnector } from "@opencode-workflow/sdk";
import type { IVault } from "@opencode-workflow/sdk";

/**
 * Коннектор vault: управление секретами как команды (vault.get/set/list/
 * delete). Изоляция — на уровне rt.vault (self-scoped); здесь scope — из
 * params (trust-on-use, админский путь для CLI/HTTP и power-нод).
 * Значения никогда не логируются — только scope/key в ошибках.
 */
export class VaultConnector implements IServiceConnector {
  readonly service = "vault";

  constructor(private readonly vault: IVault) {}

  canHandle(service: string): boolean {
    return service === this.service;
  }

  async execute(command: ICommand, _signal?: AbortSignal): Promise<CommandResult> {
    try {
      const scope = VaultConnector.str(command.params.scope, "scope");
      switch (command.op) {
        case "get": {
          const key = VaultConnector.str(command.params.key, "key");
          return { ok: true, data: { value: await this.vault.get(scope, key) } };
        }
        case "set": {
          const key = VaultConnector.str(command.params.key, "key");
          const value = VaultConnector.str(command.params.value, "value");
          await this.vault.set(scope, key, value);
          return { ok: true, data: { scope, key } };
        }
        case "delete": {
          const key = VaultConnector.str(command.params.key, "key");
          await this.vault.delete(scope, key);
          return { ok: true, data: { scope, key } };
        }
        case "list":
          return { ok: true, data: { scope, keys: await this.vault.list(scope) } };
        default:
          return { ok: false, error: `unknown op "${command.op}"` };
      }
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private static str(value: unknown, what: string): string {
    if (typeof value !== "string" || !value) throw new Error(`для "vault.*" обязателен params.${what}`);
    return value;
  }
}
