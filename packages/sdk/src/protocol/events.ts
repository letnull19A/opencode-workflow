/** Генерик-шина событий (протокол). Конкретный union типов задаёт платформа. */
export interface IEventBus<TEvent> {
  publish(event: TEvent): void;
  subscribe(listener: (event: TEvent) => void): () => void;
}

/** Источник событий для поздних потребителей (SSE, дашборды): история в памяти. */
export interface IEventHistory<TEvent> {
  history(): readonly TEvent[];
}