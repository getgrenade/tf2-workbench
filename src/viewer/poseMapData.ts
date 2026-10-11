// The segments of the pose mode body map: a Heavy-shaped figure (viewBox 60 0 530 810), symmetric about x = 321, converted from a hand-drawn
// segmentation. The viewer's left is the character's right side (R). The four spine bands are the spine bones (spine0 is the lowest).
export const POSE_MAP_VIEWBOX = "60 0 530 810";

export interface MapRegion {
  key: string;
  label: string;
  polygons: string[];
}

export const POSE_MAP: MapRegion[] = [
  { key: "head", label: "Head", polygons: ["358,62 357,72 355,81 352,90 347,97 342,104 335,108 328,111 321,112 314,111 307,108 300,104 295,97 290,90 287,81 285,72 284,62 285,52 287,43 290,34 295,27 300,20 307,16 314,13 321,12 328,13 335,16 342,20 347,27 352,34 355,43 357,52"] },
  { key: "neck", label: "Neck", polygons: ["305,130 337,130 338,150 304,150"] },
  { key: "shoulderR", label: "Right shoulder", polygons: ["252,104 278,114 282,142 204,168 192,138"] },
  { key: "shoulderL", label: "Left shoulder", polygons: ["450,138 438,168 360,142 364,114 390,104"] },
  { key: "spine3", label: "Chest", polygons: ["286,160 356,160 430,194 430,240 212,240 212,194"] },
  { key: "spine2", label: "Spine 3", polygons: ["212,258 430,258 428,310 214,310"] },
  { key: "spine1", label: "Spine 2", polygons: ["218,330 424,330 418,374 224,374"] },
  { key: "spine0", label: "Spine 1", polygons: ["226,396 416,396 410,434 232,434"] },
  { key: "pelvis", label: "Pelvis", polygons: ["232,456 410,456 414,472 332,516 310,516 228,472"] },
  { key: "upperArmR", label: "Right upper arm", polygons: ["170,156 198,196 194,262 176,308 120,296 128,230 146,184"] },
  { key: "upperArmL", label: "Left upper arm", polygons: ["496,184 514,230 522,296 466,308 448,262 444,196 472,156"] },
  { key: "forearmR", label: "Right forearm", polygons: ["104,322 168,336 146,416 88,412"] },
  { key: "forearmL", label: "Left forearm", polygons: ["554,412 496,416 474,336 538,322"] },
  { key: "handR", label: "Right hand", polygons: ["88,438 150,438 158,490 144,496 132,482 126,510 146,556 116,550 92,514 82,446"] },
  { key: "handL", label: "Left hand", polygons: ["560,446 550,514 526,550 496,556 516,510 510,482 498,496 484,490 492,438 554,438"] },
  { key: "thighR", label: "Right thigh", polygons: ["224,496 286,524 298,548 292,594 220,588"] },
  { key: "thighL", label: "Left thigh", polygons: ["422,588 350,594 344,548 356,524 418,496"] },
  { key: "shinR", label: "Right shin", polygons: ["218,616 286,616 280,696 224,698"] },
  { key: "shinL", label: "Left shin", polygons: ["418,698 362,696 356,616 424,616"] },
  { key: "footR", label: "Right foot", polygons: ["266,716 282,788 194,788 204,766 232,754 234,718"] },
  { key: "footL", label: "Left foot", polygons: ["408,718 410,754 438,766 448,788 360,788 376,716"] },
];
