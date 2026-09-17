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
  /** Randomize: dishes already seen for this request. */
  avoidTitles: string[];
  seed: string | null;
}

export interface GenerateOutput {
  content: RecipeContent;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

export interface ImageInput {
  prompt: string;
  /** Square is all we need for covers and tiles. */
  size: '1024x1024';
}
export interface ImageOutput {
  png: Buffer;
  model: string;
}
export interface Verdict {
  isFood: boolean;
  matchesDish: boolean;
  /** Text, watermarks, hands/faces, or obviously inedible artefacts. */
  hasProblems: boolean;
  note: string;
}
export interface VisionOutput {
  verdict: Verdict;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

export interface AiClient {
  vendor: string;
  model: string;
  generate(input: GenerateInput, credential: CredentialPayload): Promise<GenerateOutput>;
  /** Optional: make a photo of the finished dish. Absent when the vendor can't (Anthropic). */
  generateImage?(input: ImageInput, credential: CredentialPayload): Promise<ImageOutput>;
  /** Optional: look at a photo (JPEG or PNG; the type is sniffed) and say whether it depicts the recipe. */
  describeImage?(image: Buffer, recipe: { title: string; keyIngredients: string[]; library?: boolean }, credential: CredentialPayload): Promise<VisionOutput>;
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
