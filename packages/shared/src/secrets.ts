import * as fs from 'fs';
import * as path from 'path';

export interface SecretStore {
  [key: string]: string | undefined;
}

export class SecretsManager {
  private static instance: SecretsManager;
  private secrets: SecretStore = {};

  private constructor() {
    this.loadFromEnv();
    this.loadFromSecretsFile();
  }

  public static getInstance(): SecretsManager {
    if (!SecretsManager.instance) {
      SecretsManager.instance = new SecretsManager();
    }
    return SecretsManager.instance;
  }

  /**
   * Load secrets from process.env (fallback/legacy)
   */
  private loadFromEnv() {
    this.secrets = { ...process.env };
  }

  /**
   * Enterprise feature: Load secrets from a dedicated encrypted/secure file
   * For now, reads from a local secrets.json if exists
   */
  private loadFromSecretsFile() {
    try {
      // In a real enterprise setup, this might be AWS Secrets Manager, Azure Key Vault, etc.
      const secretsPath = path.resolve(process.cwd(), 'secrets.json');
      if (fs.existsSync(secretsPath)) {
        const fileContent = fs.readFileSync(secretsPath, 'utf8');
        const parsed = JSON.parse(fileContent);
        this.secrets = { ...this.secrets, ...parsed };
      }
    } catch (e) {
      console.warn('[SecretsManager] Failed to load secrets.json', e);
    }
  }

  /**
   * Get a secret by key
   */
  public get(key: string, defaultValue?: string): string | undefined {
    return this.secrets[key] ?? defaultValue;
  }

  /**
   * Get a strictly required secret. Throws if not found.
   */
  public require(key: string): string {
    const val = this.get(key);
    if (!val) {
      throw new Error(`[SecretsManager] Required secret missing: ${key}`);
    }
    return val;
  }

  /**
   * Set a secret dynamically (e.g. injected via admin panel)
   */
  public set(key: string, value: string) {
    this.secrets[key] = value;
  }

  /**
   * Gets all loaded secrets
   */
  public all(): SecretStore {
    return { ...this.secrets };
  }
}

export const secrets = SecretsManager.getInstance();
