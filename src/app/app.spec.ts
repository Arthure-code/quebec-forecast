import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { App } from './app';
import { CurrentWeather, ForecastDay, MonthlyAverage } from './forecast/forecast-day';
import { ForecastService, addDays } from './forecast/forecast.service';

const today = new Date(2026, 8, 17);

const day = (date: Date, chanceOfRain: number | null = null, sky = 'Overcast'): ForecastDay => ({
  date,
  low: 10,
  high: 20,
  precipitation: 1.5,
  chanceOfRain,
  sky,
});

// The service as the component sees it: one answer per month asked.
class ForecastStub {
  byMonth = new Map<string, Observable<ForecastDay[]>>();
  asked: string[] = [];
  currentAnswer: Observable<CurrentWeather | undefined> = of({
    time: new Date(2026, 8, 17, 15, 30),
    temperature: 14.6,
    sky: 'Partly cloudy',
    isDay: true,
  });
  upcomingAnswer: Observable<ForecastDay[]> = of([
    day(today, 40),
    day(addDays(today, 1), 60, 'Rain'),
  ]);
  averagesAnswer: Observable<MonthlyAverage[]> = of([]);

  month(year: number, month: number): Observable<ForecastDay[]> {
    this.asked.push(`${year}-${month}`);
    return this.byMonth.get(`${year}-${month}`) ?? of([]);
  }

  current(): Observable<CurrentWeather | undefined> {
    return this.currentAnswer;
  }

  upcoming(): Observable<ForecastDay[]> {
    return this.upcomingAnswer;
  }

  averages(): Observable<MonthlyAverage[]> {
    return this.averagesAnswer;
  }
}

describe('App', () => {
  let fixture: ComponentFixture<App>;
  let stub: ForecastStub;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = (testId: string) =>
    root().querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim();
  const click = async (testId: string) => {
    root().querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
    await fixture.whenStable();
  };
  const rows = () =>
    root().querySelectorAll(
      '[data-testid="days"] tbody tr, [data-testid="averages-table"] tbody tr',
    ).length;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(today);
    stub = new ForecastStub();
    stub.byMonth.set(
      '2026-8',
      of([day(addDays(today, -1)), day(today, 40), day(addDays(today, 1), 60)]),
    );
    stub.byMonth.set('2026-7', of([day(new Date(2026, 7, 1)), day(new Date(2026, 7, 2))]));
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: ForecastService, useValue: stub }],
    }).compileComponents();
    fixture = TestBed.createComponent(App);
    await fixture.whenStable();
  });

  afterEach(() => vi.useRealTimers());

  it('shows right now and today in the header panel', () => {
    expect(text('now-time')).toBe('Right now, 3:30 PM');
    expect(text('now-temperature')).toBe('15°C');
    expect(text('now-sky')).toBe('Partly cloudy');
    expect(text('today')).toBe('High 20° Low 10° Rain 1.5 mm Chance of rain 40 %');
    expect(root().classList.contains('night')).toBe(false);
  });

  it('switches to the night sky when the sun is down', async () => {
    stub.currentAnswer = of({ time: today, temperature: 5, sky: 'Clear sky', isDay: false });
    fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    expect(root().classList.contains('night')).toBe(true);
  });

  it('draws seven cards for the week and fills the ones the API answered', () => {
    const cards = root().querySelectorAll('[data-testid="strip"] .card-day');
    expect(cards.length).toBe(7);
    expect(cards[0].classList.contains('today')).toBe(true);
    const card = (i: number) => cards[i].textContent?.replace(/\s+/g, ' ').trim();
    expect(card(0)).toBe('17TodayOvercast20°10°40 % rain');
    expect(card(1)).toContain('Rain');
    expect(cards[2].querySelector('.placeholder')).not.toBeNull();
  });

  it('opens on the current month with its days', () => {
    expect(text('title')).toBe('September 2026');
    expect(rows()).toBe(3);
  });

  it('shows the chance of rain for forecast days and "measured" for past ones', () => {
    const cells = root().querySelectorAll('[data-testid="days"] tbody tr td:last-child');
    expect(cells[0].textContent?.trim()).toBe('measured');
    expect(cells[1].textContent?.trim()).toBe('40 %');
    expect(root().querySelectorAll('[data-testid="days"] tr.today').length).toBe(1);
  });

  it('moves to the previous month and back', async () => {
    await click('previous');
    expect(text('title')).toBe('August 2026');
    expect(rows()).toBe(2);

    await click('current');
    expect(text('title')).toBe('September 2026');
    expect(stub.asked).toEqual(['2026-8', '2026-7', '2026-8']);
  });

  it('stops the next button where the forecast ends', async () => {
    const next = root().querySelector<HTMLButtonElement>('[data-testid="next"]');
    expect(next?.disabled).toBe(false);

    await click('next');
    expect(text('title')).toBe('October 2026');
    expect(text('empty')).toBe('No data for this month yet.');
    expect(next?.disabled).toBe(true);
  });

  it('shows one row per month of averages', async () => {
    stub.averagesAnswer = of([
      { year: 2026, month: 7, low: 14.1, high: 24.3, precipitation: 2.7, days: 31 },
      { year: 2026, month: 8, low: 9, high: 17.5, precipitation: 1.7, days: 30 },
    ]);

    await click('averages');

    expect(text('title')).toBe('Averages of the last 6 months');
    expect(rows()).toBe(2);
    const cells = [
      ...root().querySelectorAll('[data-testid="averages-table"] tbody tr:first-child td'),
    ];
    expect(cells.map((cell) => cell.textContent?.trim())).toEqual([
      'August 2026',
      '14.1 °C',
      '24.3 °C',
      '2.7 mm',
      '31',
    ]);
  });

  it('says so when the service does not answer', async () => {
    stub.byMonth.set(
      '2026-7',
      throwError(() => new Error('down')),
    );

    await click('previous');

    expect(text('error')).toContain('The weather service did not answer');
    expect(rows()).toBe(0);
  });
});
