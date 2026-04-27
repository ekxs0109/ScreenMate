declare module "dplayer" {
  export type DPlayerCustomTypeHandler = (
    video: HTMLVideoElement,
    player: unknown,
  ) => void;

  export type DPlayerOptions = {
    container: HTMLElement;
    autoplay?: boolean;
    live?: boolean;
    mutex?: boolean;
    video?: {
      url: string;
      type?: string;
      customType?: Record<string, DPlayerCustomTypeHandler>;
    };
  };

  export default class DPlayer {
    constructor(options: DPlayerOptions);
    readonly container: HTMLElement;
    readonly options: DPlayerOptions;
    readonly video: HTMLVideoElement;
    on(event: string, handler: () => void): void;
    destroy(): void;
  }
}
