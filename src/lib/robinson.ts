type RobinsonPoint = {
  x: number;
  y: number;
};

const ROBINSON_HALF_HEIGHT = 91.296;
const ROBINSON_VIEWBOX_LEFT = -180;
const ROBINSON_VIEWBOX_RIGHT = 180;
const ROBINSON_VIEWBOX_TOP = -ROBINSON_HALF_HEIGHT;
const ROBINSON_VIEWBOX_BOTTOM = ROBINSON_HALF_HEIGHT;
const ROBINSON_Y_BY_LAT = [
  0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571,
  0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1,
];

function interpolate(table: number[], latitude: number) {
  const absoluteLatitude = Math.min(Math.abs(latitude), 90);
  const lowerIndex = Math.floor(absoluteLatitude / 5);
  const upperIndex = Math.min(lowerIndex + 1, table.length - 1);
  const fraction = (absoluteLatitude - lowerIndex * 5) / 5;

  return table[lowerIndex] + (table[upperIndex] - table[lowerIndex]) * fraction;
}

export function projectRobinson(latitude: number, longitude: number): RobinsonPoint {
  const yScale = interpolate(ROBINSON_Y_BY_LAT, latitude);
  const x = longitude;
  const y = -Math.sign(latitude) * ROBINSON_HALF_HEIGHT * yScale;

  return {
    x: ((x - ROBINSON_VIEWBOX_LEFT) / (ROBINSON_VIEWBOX_RIGHT - ROBINSON_VIEWBOX_LEFT)) * 100,
    y: ((y - ROBINSON_VIEWBOX_TOP) / (ROBINSON_VIEWBOX_BOTTOM - ROBINSON_VIEWBOX_TOP)) * 100,
  };
}
