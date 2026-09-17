import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { CurrentWeather, ForecastDay, MonthlyAverage } from './forecast/forecast-day';
import { ForecastService, addDays, startOfToday } from './forecast/forecast.service';

const AVERAGED_MONTHS = 6;
const FORECAST_REACH = 15;
const STRIP_DAYS = 7;

@Component({
  selector: 'app-root',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: { '[class.night]': '!isDay()' },
})
export class App {
  private readonly forecast = inject(ForecastService);

  readonly current = signal<CurrentWeather | undefined>(undefined);
  readonly upcoming = signal<ForecastDay[]>([]);
  readonly year = signal(startOfToday().getFullYear());
  readonly month = signal(startOfToday().getMonth());
  readonly view = signal<'days' | 'averages'>('days');
  readonly days = signal<ForecastDay[]>([]);
  readonly averages = signal<MonthlyAverage[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);

  readonly today = computed(() => this.upcoming()[0]);
  readonly isDay = computed(() => this.current()?.isDay ?? true);
  readonly monthStart = computed(() => new Date(this.year(), this.month(), 1));
  readonly averagedMonths = AVERAGED_MONTHS;
  readonly todayTime = startOfToday().getTime();

  // The dates of the month are known before the API answers, so the table
  // is drawn with them right away and only the numbers arrive later;
  // nothing on the page moves when they do.
  readonly expectedDates = computed(() => {
    const last = new Date(this.year(), this.month() + 1, 0);
    const reach = addDays(startOfToday(), FORECAST_REACH);
    const end = last < reach ? last : reach;
    const dates: Date[] = [];
    for (let date = this.monthStart(); date <= end; date = addDays(date, 1)) dates.push(date);
    return dates;
  });

  readonly expectedMonths = Array.from({ length: AVERAGED_MONTHS }, (_, i) => {
    const today = startOfToday();
    return new Date(today.getFullYear(), today.getMonth() - (AVERAGED_MONTHS - 1 - i), 1);
  });

  readonly stripDates = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(startOfToday(), i));

  // The forecast reaches 16 days ahead; the month after that would only
  // ever show an empty table, so the button stops there.
  readonly canGoForward = computed(() => {
    const next = new Date(this.year(), this.month() + 1, 1);
    return next <= addDays(startOfToday(), FORECAST_REACH);
  });

  constructor() {
    this.forecast.current().subscribe({ next: (now) => this.current.set(now) });
    this.forecast.upcoming(STRIP_DAYS).subscribe({ next: (days) => this.upcoming.set(days) });
    this.loadMonth();
  }

  previousMonth(): void {
    this.shiftMonth(-1);
  }

  nextMonth(): void {
    if (this.canGoForward()) this.shiftMonth(1);
  }

  currentMonth(): void {
    const today = startOfToday();
    this.year.set(today.getFullYear());
    this.month.set(today.getMonth());
    this.loadMonth();
  }

  showAverages(): void {
    this.view.set('averages');
    this.loading.set(true);
    this.error.set(false);
    this.forecast.averages(AVERAGED_MONTHS).subscribe({
      next: (rows) => {
        this.averages.set(rows);
        this.loading.set(false);
      },
      error: () => this.fail(),
    });
  }

  monthDate(row: MonthlyAverage): Date {
    return new Date(row.year, row.month, 1);
  }

  isToday(day: ForecastDay): boolean {
    return day.date.getTime() === this.todayTime;
  }

  private shiftMonth(step: number): void {
    const moved = new Date(this.year(), this.month() + step, 1);
    this.year.set(moved.getFullYear());
    this.month.set(moved.getMonth());
    this.loadMonth();
  }

  private loadMonth(): void {
    this.view.set('days');
    this.loading.set(true);
    this.error.set(false);
    this.forecast.month(this.year(), this.month()).subscribe({
      next: (days) => {
        this.days.set(days);
        this.loading.set(false);
      },
      error: () => this.fail(),
    });
  }

  private fail(): void {
    this.days.set([]);
    this.averages.set([]);
    this.loading.set(false);
    this.error.set(true);
  }
}
