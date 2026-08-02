/** 画面をまたいで引き継ぐ3D表示位置。 */
export interface StageViewState {
  cameraPosition: [number, number, number];
  target: [number, number, number];
  zoom: number;
}
