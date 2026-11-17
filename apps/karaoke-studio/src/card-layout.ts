// Where a karaoke card's parts sit, in its layout's own pixels: the same table as karaoke/video.py's LAYOUTS, so the
// preview shows the card the video will. A video is laid out at its layout's size and scaled to its frame.

export interface CardLayout {
  width: number; height: number;
  /** Centres of the title, the line being sung and how tall it may grow, the same with a pronunciation under it. */
  title: number; middle: number; room: number; saidMiddle: number; saidRoom: number;
  /** Centres of the pronunciation, the count-in dots, the next line and the footer; how wide a line may run. */
  said: number; dots: number; next: number; footer: number; wrap: number;
}

export const CARD_LAYOUTS = {
  landscape: { width: 1280, height: 720, title: 80, middle: 320, room: 300, saidMiddle: 290, saidRoom: 200, said: 430, dots: 430, next: 540, footer: 660, wrap: 1000 },
  portrait: { width: 720, height: 1280, title: 140, middle: 500, room: 440, saidMiddle: 470, saidRoom: 280, said: 670, dots: 610, next: 860, footer: 1180, wrap: 600 },
} as const satisfies Record<string, CardLayout>;

export const VIDEO_SIZES = { '720p': [1280, 720], '1080p': [1920, 1080], vertical: [1080, 1920] } as const;
export type VideoSize = keyof typeof VIDEO_SIZES;

export const isVideoSize = (value: string): value is VideoSize => Object.hasOwn(VIDEO_SIZES, value);

/** The layout a video of ``size`` is drawn in: upright for a frame taller than it is wide. */
export function cardLayout(size: string): CardLayout {
  const [width, height] = VIDEO_SIZES[isVideoSize(size) ? size : '720p'];
  return height > width ? CARD_LAYOUTS.portrait : CARD_LAYOUTS.landscape;
}
