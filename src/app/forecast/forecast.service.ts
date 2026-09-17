import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, of, shareReplay } from 'rxjs';
import { CurrentWeather, ForecastDay, MonthlyAverage, describeSky } from './forecast-day';

// Québec City, as Open-Meteo wants it.
const LOCATION = { latitude: '46.81', longitude: '-71.21', timezone: 'America/Toronto' };

// The forecast endpoint answers with the coming 16 days and, on request,
// up to 31 past days; the archive endpoint holds every day before that.
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const PAST_DAYS = 31;
const FORECAST_DAYS = 16;
const DAILY = 'weather_code,temperature_2m_min,temperature_2m_max,precipitation_sum';

// The shape of an answer from either endpoint.
interface WeatherResponse {
  current?: {
    time: string;
    temperature_2m: number;
    weather_code: number;
    is_day: number;
  };
  daily: {
    time: string[];
    weather_code: (number | null)[];
    temperature_2m_min: (number | null)[];
    temperature_2m_max: (number | null)[];
    precipitation_sum: (number | null)[];
    precipitation_probability_max?: (number | null)[];
  };
}

interface ForecastWindow {
  current: CurrentWeather | undefined;
  days: ForecastDay[];
}

@Injectable({ providedIn: 'root' })
export class ForecastService {
  private readonly http = inject(HttpClient);
  private readonly archived = new Map<string, Observable<ForecastDay[]>>();

  // One request for the window around today, shared by every caller.
  private readonly window$: Observable<ForecastWindow> = this.http
    .get<WeatherResponse>(FORECAST_URL, {
      params: {
        ...LOCATION,
        current: 'temperature_2m,weather_code,is_day',
        daily: `${DAILY},precipitation_probability_max`,
        past_days: PAST_DAYS,
        forecast_days: FORECAST_DAYS,
      },
    })
    .pipe(
      map((response) => ({ current: toCurrent(response), days: toDays(response) })),
      shareReplay(1),
    );

  // Every day of a month the service knows about: the archive for the days
  // before the window, the window for the rest. Months with no day yet
  // (too far ahead) come back empty.
  month(year: number, month: number): Observable<ForecastDay[]> {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const windowStart = addDays(startOfToday(), -PAST_DAYS);

    const inWindow$ = this.window$.pipe(
      map(({ days }) => days.filter((day) => day.date >= first && day.date <= last)),
    );
    if (first >= windowStart) return inWindow$;

    const archiveEnd = last < windowStart ? last : addDays(windowStart, -1);
    return forkJoin([this.archive(first, archiveEnd), inWindow$]).pipe(
      map(([past, recent]) => [...past, ...recent]),
    );
  }

  // Right now, as the forecast endpoint reports it.
  current(): Observable<CurrentWeather | undefined> {
    return this.window$.pipe(map(({ current }) => current));
  }

  // Today and the days after it, as many as asked and the API has.
  upcoming(count: number): Observable<ForecastDay[]> {
    const today = startOfToday();
    return this.window$.pipe(
      map(({ days }) => days.filter((day) => day.date >= today).slice(0, count)),
    );
  }

  // The last `count` months, this one included, each reduced to its means.
  averages(count: number): Observable<MonthlyAverage[]> {
    const today = startOfToday();
    const months = Array.from({ length: count }, (_, i) => {
      const date = new Date(today.getFullYear(), today.getMonth() - (count - 1 - i), 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });
    if (months.length === 0) return of([]);
    return forkJoin(months.map(({ year, month }) => this.month(year, month))).pipe(
      map((lists) =>
        lists
          .map((days, i) => average(months[i].year, months[i].month, days))
          .filter((item): item is MonthlyAverage => item !== null),
      ),
    );
  }

  private archive(from: Date, to: Date): Observable<ForecastDay[]> {
    const key = `${toIso(from)}/${toIso(to)}`;
    let request = this.archived.get(key);
    if (!request) {
      request = this.http
        .get<WeatherResponse>(ARCHIVE_URL, {
          params: { ...LOCATION, daily: DAILY, start_date: toIso(from), end_date: toIso(to) },
        })
        .pipe(map(toDays), shareReplay(1));
      this.archived.set(key, request);
    }
    return request;
  }
}

function toCurrent(response: WeatherResponse): CurrentWeather | undefined {
  const current = response.current;
  if (!current) return undefined;
  return {
    time: new Date(current.time),
    temperature: current.temperature_2m,
    sky: describeSky(current.weather_code),
    isDay: current.is_day === 1,
  };
}

// Open-Meteo answers in columns; the app wants rows, and only complete
// ones. A chance of rain only makes sense from today on: for a day that
// has passed, the precipitation column already says what fell.
function toDays(response: WeatherResponse): ForecastDay[] {
  const { time, weather_code, temperature_2m_min, temperature_2m_max, precipitation_sum } =
    response.daily;
  const chance = response.daily.precipitation_probability_max;
  const today = startOfToday();
  const days: ForecastDay[] = [];
  time.forEach((iso, i) => {
    const low = temperature_2m_min[i];
    const high = temperature_2m_max[i];
    if (low === null || high === null) return;
    const date = fromIso(iso);
    days.push({
      date,
      low,
      high,
      precipitation: precipitation_sum[i] ?? 0,
      chanceOfRain: date >= today ? (chance?.[i] ?? null) : null,
      sky: describeSky(weather_code[i]),
    });
  });
  return days;
}

function average(year: number, month: number, days: ForecastDay[]): MonthlyAverage | null {
  if (days.length === 0) return null;
  const mean = (pick: (day: ForecastDay) => number) =>
    Math.round((days.reduce((sum, day) => sum + pick(day), 0) / days.length) * 10) / 10;
  return {
    year,
    month,
    low: mean((day) => day.low),
    high: mean((day) => day.high),
    precipitation: mean((day) => day.precipitation),
    days: days.length,
  };
}

// Dates are handled as local midnights so that "2026-09-17" from the API
// and today's date compare as the same day.
function fromIso(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
