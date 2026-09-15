import type { Ingredient, Profile, RecipeContent } from '@foodi/shared';
import type { CredentialPayload } from '../auth/providers/types.js';

export interface GenerateInput {
  profile: Profile;
  prompt: string;
  requestedIngredients: Ingredient[];
  servings: number;
  timeBudgetMinutes: number;
  mealType: string | null;
  /** When tweaking an existing recipe. */
  basedOn: RecipeContent | null;
}

export interface GenerateOutput {
  content: RecipeContent;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

export interface AiClient {
  vendor: string;
  model: string;
  generate(input: GenerateInput, credential: CredentialPayload): Promise<GenerateOutput>;
}

export class AiError extends Error {
  constructor(
    public code: 'credential_rejected' | 'credential_unusable' | 'rate_limited' | 'bad_output' | 'vendor_error' | 'network',
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
