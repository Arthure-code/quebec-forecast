import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ARCHIVE_URL,
  FORECAST_URL,
  ForecastService,
  addDays,
  startOfToday,
} from './forecast.service';
import { CurrentWeather, ForecastDay, describeSky } from './forecast-day';

// An answer in Open-Meteo's shape, one entry per date given: lows from
// 10, highs from 20, half a millimetre more each day, code 0 then 1, 2...
function answer(dates: Date[], withChance = true) {
  const column = (from: number, step: number): (number | null)[] =>
    dates.map((_, i) => from + i * step);
  return {
    daily: {
      time: dates.map(iso),
      weather_code: column(0, 1),
      temperature_2m_min: column(10, 1),
      temperature_2m_max: column(20, 1),
      precipitation_sum: column(0, 0.5),
      ...(withChance ? { precipitation_probability_max: column(0, 10) } : {}),
    },
  };
}

function iso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function range(from: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

describe('describeSky', () => {
  it('names the WMO codes and admits what it does not know', () => {
    expect(describeSky(0)).toBe('Clear sky');
    expect(describeSky(63)).toBe('Rain');
    expect(describeSky(95)).toBe('Thunderstorm');
    expect(describeSky(42)).toBe('Unknown');
    expect(describeSky(null)).toBe('Unknown');
  });
});

describe('ForecastService', () => {
  let service: ForecastService;
  let http: HttpTestingController;
  // The clock is pinned mid-month so that yesterday, today and tomorrow
  // all fall in the same month whatever the day the tests run.
  const today = new Date(2026, 8, 17);
  const windowStart = addDays(today, -31);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(today);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ForecastService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('starts today at local midnight', () => {
    expect(startOfToday()).toEqual(today);
  });

  it('turns the columns of the forecast answer into one row per day', () => {
    let days: ForecastDay[] = [];
    service.month(today.getFullYear(), today.getMonth()).subscribe((result) => (days = result));

    const request = http.expectOne((req) => req.url === FORECAST_URL);
    expect(request.request.params.get('past_days')).toBe('31');
    expect(request.request.params.get('forecast_days')).toBe('16');
    expect(request.request.params.get('current')).toContain('temperature_2m');
    request.flush(answer([today, addDays(today, 1)]));

    expect(days.length).toBe(2);
    expect(days[0]).toEqual({
      date: today,
      low: 10,
      high: 20,
      precipitation: 0,
      chanceOfRain: 0,
      sky: 'Clear sky',
    });
    expect(days[1].chanceOfRain).toBe(10);
    expect(days[1].sky).toBe('Mainly clear');
  });

  it('drops the days the API has no temperature for', () => {
    let days: ForecastDay[] = [];
    service.month(today.getFullYear(), today.getMonth()).subscribe((result) => (days = result));

    const body = answer([today, addDays(today, 1)]);
    body.daily.temperature_2m_min[1] = null;
    http.expectOne((req) => req.url === FORECAST_URL).flush(body);

    expect(days.map((day) => day.date)).toEqual([today]);
  });

  it('keeps the chance of rain for today and later only', () => {
    let days: ForecastDay[] = [];
    service.month(today.getFullYear(), today.getMonth()).subscribe((result) => (days = result));

    http.expectOne((req) => req.url === FORECAST_URL).flush(answer([addDays(today, -1), today]));

    expect(days[0].chanceOfRain).toBeNull();
    expect(days[1].chanceOfRain).toBe(10);
  });

  it('asks the archive for the part of a month that is before the window', () => {
    const past = addDays(windowStart, -40);
    const year = past.getFullYear();
    const month = past.getMonth();
    const first = new Date(year, month, 1);
    let days: ForecastDay[] = [];
    service.month(year, month).subscribe((result) => (days = result));

    const archive = http.expectOne((req) => req.url === ARCHIVE_URL);
    expect(archive.request.params.get('start_date')).toBe(iso(first));
    expect(archive.request.params.get('end_date')).toBe(iso(new Date(year, month + 1, 0)));
    archive.flush(answer(range(first, 3), false));
    http.expectOne((req) => req.url === FORECAST_URL).flush(answer([today]));

    expect(days.length).toBe(3);
    expect(days[0].chanceOfRain).toBeNull();
  });

  it('makes one forecast request however many callers there are', () => {
    service.month(today.getFullYear(), today.getMonth()).subscribe();
    service.current().subscribe();
    service.upcoming(7).subscribe();
    http.expectOne((req) => req.url === FORECAST_URL).flush(answer([today]));

    service.month(today.getFullYear(), today.getMonth()).subscribe();
    http.expectNone((req) => req.url === FORECAST_URL);
  });

  it('reads the current conditions from the same answer', () => {
    let now: CurrentWeather | undefined;
    service.current().subscribe((result) => (now = result));

    http
      .expectOne((req) => req.url === FORECAST_URL)
      .flush({
        current: { time: '2026-09-17T03:30', temperature_2m: 10.9, weather_code: 2, is_day: 0 },
        ...answer([today]),
      });

    expect(now).toEqual({
      time: new Date(2026, 8, 17, 3, 30),
      temperature: 10.9,
      sky: 'Partly cloudy',
      isDay: false,
    });
  });

  it('lists the coming days from today, as many as asked', () => {
    let days: ForecastDay[] = [];
    service.upcoming(2).subscribe((result) => (days = result));

    http.expectOne((req) => req.url === FORECAST_URL).flush(answer(range(addDays(today, -2), 6)));

    expect(days.map((day) => day.date)).toEqual([today, addDays(today, 1)]);
  });

  it('averages each month and skips the empty ones', () => {
    let rows: { month: number; low: number; high: number; precipitation: number; days: number }[] =
      [];
    service.averages(2).subscribe((result) => (rows = result));

    http.match((req) => req.url === ARCHIVE_URL).forEach((req) => req.flush(answer([], false)));
    http.expectOne((req) => req.url === FORECAST_URL).flush(answer(range(addDays(today, -1), 3)));

    // Last month got nothing from the archive and nothing from the window.
    expect(rows).toEqual([
      { year: 2026, month: 8, low: 11, high: 21, precipitation: 0.5, days: 3 },
    ]);
  });
});
