import { Injectable } from '@nestjs/common';

export type RentalPeriodType = 'weekly' | 'monthly' | 'custom';

export interface RentalConfiguration {
  startDate: Date;
  endDate: Date;
  rentalType: RentalPeriodType;
  durationDays: number;
  durationWeeks: number;
  durationMonths: number;
  minChargeApplies: boolean;
}

@Injectable()
export class RentalService {
  calculateDuration(
    startDate: Date,
    endDate: Date,
    rentalType: RentalPeriodType,
  ): RentalConfiguration {
    const start = new Date(startDate);
    const end = new Date(endDate);

    let baseDays: number;

    if (rentalType === 'custom') {
      baseDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    } else if (rentalType === 'weekly') {
      // For weekly, calculate based on actual days
      baseDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    } else {
      // Monthly - standardized to 30 days per month for Japan
      baseDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    }

    const durationWeeks = Math.ceil(baseDays / 7);
    const durationMonths = Math.ceil(baseDays / 30);

    return {
      startDate: start,
      endDate: end,
      rentalType,
      durationDays: baseDays,
      durationWeeks,
      durationMonths,
      minChargeApplies: baseDays < 7, // 1-week minimum standard
    };
  }

  calculatePeriodCostFactors(
    config: RentalConfiguration,
    baseCost: number,
  ): {
    basicCharge: number;
    damageCharge: number;
    transportFeeAdjustment: number;
  } {
    const basicChargePeriod = config.durationMonths;
    const damageChargePeriod = config.durationDays;

    // Transport fee adjustment: monthly = 1x, weekly = 1.3x
    const transportFeeAdjustment = config.rentalType === 'weekly' ? 1.3 : 1.0;

    return {
      basicCharge: baseCost * basicChargePeriod,
      damageCharge: baseCost * 0.01 * damageChargePeriod, // 1% per day
      transportFeeAdjustment,
    };
  }
}
