/**
 * Vault (протокол): изолированное per-workflow хранилище секретов.
 * Scope — id workflow; значение видно только владельцу scope. Реализация
 * живёт на платформе; манифест workflows секретов не содержит — ключ
 * workflow id всегда известен ей по контексту прогона.
 */
export interface IVault {
  /** Вернуть значение секрета. Бросает VaultKeyMissing, если scope/key нет. */
  get(scope: string, key: string): Promise<string>;
  /** Установить/перезаписать секрет. */
  set(scope: string, key: string, value: string): Promise<void>;
  /** Удалить секрет. Бросает VaultKeyMissing, если scope/key нет. */
  delete(scope: string, key: string): Promise<void>;
  /** Список имён ключей scope (значений нет — safe для логов и API). */
  list(scope: string): Promise<string[]>;
  /** Есть ли секрет в scope. */
  has(scope: string, key: string): Promise<boolean>;
  /**
   * Ротация мастер-ключа: перезашифровать всё под новым ключом.
   * Оператор обязан обновить источник мастер-ключа в env и
   * перезапустить процесс (иначе следующий старт не откроет vault).
   */
  rotate(newMasterKeyBase64: string): Promise<void>;
}
