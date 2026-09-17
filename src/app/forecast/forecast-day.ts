// One day of weather: what was measured for a past day, what is expected
// for a coming one. The chance of rain only exists for forecast days.
export interface ForecastDay {
  date: Date;
  low: number;
  high: number;
  precipitation: number;
  chanceOfRain: number | null;
  sky: string;
}

// What it is like right now.
export interface CurrentWeather {
  time: Date;
  temperature: number;
  sky: string;
  isDay: boolean;
}

// The mean of a month's days, shown one row per month.
export interface MonthlyAverage {
  year: number;
  month: number;
  low: number;
  high: number;
  precipitation: number;
  days: number;
}

// The WMO weather codes Open-Meteo uses, in a few words each.
const SKIES = new Map<number, string>([
  [0, 'Clear sky'],
  [1, 'Mainly clear'],
  [2, 'Partly cloudy'],
  [3, 'Overcast'],
  [45, 'Fog'],
  [48, 'Rime fog'],
  [51, 'Light drizzle'],
  [53, 'Drizzle'],
  [55, 'Dense drizzle'],
  [56, 'Freezing drizzle'],
  [57, 'Freezing drizzle'],
  [61, 'Light rain'],
  [63, 'Rain'],
  [65, 'Heavy rain'],
  [66, 'Freezing rain'],
  [67, 'Freezing rain'],
  [71, 'Light snow'],
  [73, 'Snow'],
  [75, 'Heavy snow'],
  [77, 'Snow grains'],
  [80, 'Rain showers'],
  [81, 'Rain showers'],
  [82, 'Violent rain showers'],
  [85, 'Snow showers'],
  [86, 'Heavy snow showers'],
  [95, 'Thunderstorm'],
  [96, 'Thunderstorm with hail'],
  [99, 'Thunderstorm with heavy hail'],
]);

export function describeSky(code: number | null | undefined): string {
  return SKIES.get(code ?? -1) ?? 'Unknown';
}
