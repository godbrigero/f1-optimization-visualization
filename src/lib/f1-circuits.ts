export type Circuit = {
  key: string;
  name: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  mapPosition: {
    x: number;
    y: number;
  };
};

export const circuits = [
  { key: "melbourne", name: "Albert Park", city: "Melbourne", country: "Australia", latitude: -37.8497, longitude: 144.968, mapPosition: { x: 85.4, y: 71.1 } },
  { key: "shanghai", name: "Shanghai Intl", city: "Shanghai", country: "China", latitude: 31.3389, longitude: 121.22, mapPosition: { x: 80.7, y: 30.8 } },
  { key: "suzuka", name: "Suzuka", city: "Suzuka", country: "Japan", latitude: 34.8431, longitude: 136.541, mapPosition: { x: 84.2, y: 29.6 } },
  { key: "sakhir", name: "Bahrain Intl", city: "Sakhir", country: "Bahrain", latitude: 26.0325, longitude: 50.5106, mapPosition: { x: 63.7, y: 36.7 } },
  { key: "jeddah", name: "Jeddah Corniche", city: "Jeddah", country: "Saudi Arabia", latitude: 21.6319, longitude: 39.1044, mapPosition: { x: 59.9, y: 38.2 } },
  { key: "miami", name: "Miami Intl Autodrome", city: "Miami", country: "USA", latitude: 25.9581, longitude: -80.2389, mapPosition: { x: 24.6, y: 32.0 } },
  { key: "montreal", name: "Gilles Villeneuve", city: "Montreal", country: "Canada", latitude: 45.5, longitude: -73.5228, mapPosition: { x: 30.1, y: 24.5 } },
  { key: "monaco", name: "Circuit de Monaco", city: "Monte Carlo", country: "Monaco", latitude: 43.7347, longitude: 7.4206, mapPosition: { x: 51.8, y: 24.8 } },
  { key: "barcelona", name: "Catalunya", city: "Barcelona", country: "Spain", latitude: 41.57, longitude: 2.2611, mapPosition: { x: 50.1, y: 26.9 } },
  { key: "spielberg", name: "Red Bull Ring", city: "Spielberg", country: "Austria", latitude: 47.2197, longitude: 14.7647, mapPosition: { x: 53.5, y: 22.1 } },
  { key: "silverstone", name: "Silverstone", city: "Silverstone", country: "UK", latitude: 52.0786, longitude: -1.0169, mapPosition: { x: 48.2, y: 17.9 } },
  { key: "budapest", name: "Hungaroring", city: "Budapest", country: "Hungary", latitude: 47.5789, longitude: 19.2486, mapPosition: { x: 55.0, y: 23.0 } },
  { key: "spa", name: "Spa-Francorchamps", city: "Stavelot", country: "Belgium", latitude: 50.4372, longitude: 5.9714, mapPosition: { x: 49.5, y: 19.4 } },
  { key: "zandvoort", name: "Zandvoort", city: "Zandvoort", country: "Netherlands", latitude: 52.3888, longitude: 4.5409, mapPosition: { x: 50.3, y: 17.9 } },
  { key: "monza", name: "Monza", city: "Monza", country: "Italy", latitude: 45.6156, longitude: 9.2811, mapPosition: { x: 51.9, y: 23.9 } },
  { key: "madrid", name: "Madring (IFEMA)", city: "Madrid", country: "Spain", latitude: 40.465, longitude: -3.616, mapPosition: { x: 48.2, y: 26.3 } },
  { key: "baku", name: "Baku City", city: "Baku", country: "Azerbaijan", latitude: 40.3725, longitude: 49.8533, mapPosition: { x: 63.4, y: 24.8 } },
  { key: "singapore", name: "Marina Bay", city: "Singapore", country: "Singapore", latitude: 1.2914, longitude: 103.864, mapPosition: { x: 78.7, y: 49.6 } },
  { key: "austin", name: "Circuit of Americas", city: "Austin", country: "USA", latitude: 30.1328, longitude: -97.6411, mapPosition: { x: 20.8, y: 32.0 } },
  { key: "mexico_city", name: "Hermanos Rodriguez", city: "Mexico City", country: "Mexico", latitude: 19.4042, longitude: -99.0907, mapPosition: { x: 21.8, y: 36.4 } },
  { key: "sao_paulo", name: "Interlagos", city: "Sao Paulo", country: "Brazil", latitude: -23.7036, longitude: -46.6997, mapPosition: { x: 34.7, y: 60.9 } },
  { key: "las_vegas", name: "Las Vegas Strip", city: "Las Vegas", country: "USA", latitude: 36.1147, longitude: -115.1728, mapPosition: { x: 17.4, y: 27.5 } },
  { key: "losail", name: "Lusail Intl", city: "Lusail", country: "Qatar", latitude: 25.49, longitude: 51.4542, mapPosition: { x: 64.2, y: 36.7 } },
  { key: "yas_marina", name: "Yas Marina", city: "Abu Dhabi", country: "UAE", latitude: 24.4672, longitude: 54.6031, mapPosition: { x: 64.8, y: 37.3 } },
] satisfies Circuit[];

export function getCircuit(key: string) {
  const circuit = circuits.find((item) => item.key === key);

  if (!circuit) {
    throw new Error(`Unknown circuit: ${key}`);
  }

  return circuit;
}

export function haversineKm(a: Circuit, b: Circuit) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const lat1 = toRadians(a.latitude);
  const lon1 = toRadians(a.longitude);
  const lat2 = toRadians(b.latitude);
  const lon2 = toRadians(b.longitude);
  const dlat = lat2 - lat1;
  const dlon = lon2 - lon1;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;

  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function carbonProxyKg(a: Circuit, b: Circuit) {
  return haversineKm(a, b) * 350 * 0.5;
}
