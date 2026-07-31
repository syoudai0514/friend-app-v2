/** タップするたびに切り替わる視点 */
export const CHARACTER_VIEWS = ["front", "low", "back"] as const;
export type CharacterView = (typeof CHARACTER_VIEWS)[number];
