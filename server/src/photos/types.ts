/** Where a recipe photo came from. `upload` is a person's own file; the rest are auto photos. */
export const PHOTO_PROVIDERS = ['upload', 'ai', 'wikimedia', 'pexels', 'google'] as const;
export type PhotoProvider = (typeof PHOTO_PROVIDERS)[number];

/** One search hit: enough to download the file and credit its author. */
export interface PhotoCandidate {
  provider: 'wikimedia' | 'pexels' | 'google';
  /** Direct file URL. Only hosts on the download allowlist are ever fetched. */
  url: string;
  width: number;
  height: number;
  /** Author line for the caption ("Jane Doe"). */
  credit: string;
  /** Licence label ("CC BY-SA 4.0", "Pexels"). */
  license: string;
  /** The page to link the caption to. Also used to remember which photos a recipe has seen. */
  sourceUrl: string;
  /** The library's own title/alt text, used to rank hits that name the dish first. */
  title?: string;
}

export interface PhotoSource {
  id: 'wikimedia' | 'pexels' | 'google';
  search(query: string, limit: number): Promise<PhotoCandidate[]>;
}

export class PhotoError extends Error {
  constructor(
    public code: 'no_photo_found' | 'download_failed' | 'bad_image' | 'source_error',
    message: string,
  ) {
    super(message);
  }
}
