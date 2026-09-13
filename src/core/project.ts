import type { ModuleDomain } from "./types.ts";

// Профиль потребительского репозитория: чем определяется выбор
// доменного worker'а и команды верификации. Детект — по манифестам
// (nest-cli.json, *.sln/*.csproj, package.json deps), не по соглашению.
export interface IProjectProfile {
  path: string;
  domain: ModuleDomain;
  language: string;
  packageManager?: string;
  testRunner: string;
  verifyCommands: string[];
}

// Детектор проекта — стратегия, заменяемая без правки пайплайна
// (manifest-based; смена NestJS -> .NET меняет только этот узел).
export interface IProjectDetector {
  detect(projectPath: string): Promise<IProjectProfile>;
}
