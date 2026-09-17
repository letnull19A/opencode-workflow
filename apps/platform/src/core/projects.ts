/**
 * Карта проектов (Map): явное соответствие лейбла таск-менеджера полному
 * пути директории проекта в контейнере opencode-сервера. Стандарта генерации
 * лейблов из названий проектов нет — маппинг только ручной. Задачи, чьи
 * лейблы не замаплены, платформой не обрабатываются (не ошибка, а пропуск).
 */
export interface IProjectMapEntry {
  readonly label: string;
  readonly directory: string;
}

/** Реестр карты проектов: чтение/запись пар + матч задачи по лейблам. */
export interface IProjectMap {
  /** Все записи карты. */
  entries(): Promise<IProjectMapEntry[]>;
  /** Первая запись, чей лейбл есть в labels; null — маппинга нет (пропуск). */
  byLabel(label: string): Promise<IProjectMapEntry | null>;
  /** Добавить/перезаписать пару. */
  set(label: string, directory: string): Promise<void>;
  /** Удалить пару; false — такой пары не было. */
  remove(label: string): Promise<boolean>;
}
