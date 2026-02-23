import { Injectable, Logger, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quotation } from './quotation.entity';
import { QuotationItem } from './quotation-item.entity';
import { QuotationCostItem } from './quotation-cost-item.entity';
import { ScaffoldConfigService } from '../scaffold-config/scaffold-config.service';
import { QuotationCostService } from './quotation-cost.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';

@Injectable()
export class QuotationService {
  private readonly logger = new Logger(QuotationService.name);

  constructor(
    @InjectRepository(Quotation)
    private quotationRepo: Repository<Quotation>,
    @InjectRepository(QuotationItem)
    private itemRepo: Repository<QuotationItem>,
    @InjectRepository(QuotationCostItem)
    private costItemRepo: Repository<QuotationCostItem>,
    private configService: ScaffoldConfigService,
    private costService: QuotationCostService,
  ) {}

  /**
   * Create a quotation from a reviewed scaffold configuration.
   * Copies quantity data into quotation_items.
   */
  async create(dto: CreateQuotationDto, userId: string): Promise<Quotation> {
    try {
      // Verify config exists
      const config = await this.configService.getConfig(dto.configId);
      if (!config) {
        throw new NotFoundException(`Configuration with ID ${dto.configId} not found.`);
      }
      
      // Get calculated quantities first to check if calculation was done
      const quantities = await this.configService.getQuantities(dto.configId);
      if (quantities.length === 0) {
        throw new BadRequestException(
          'No calculated quantities found for this configuration. ' +
          'Please run the calculation first.',
        );
      }

    // Auto-mark as reviewed if quantities exist but status isn't reviewed yet
    // This handles race conditions where markReviewed was called but status update didn't persist
    if (config.status !== 'reviewed') {
      if (config.status === 'calculated') {
        this.logger.log(
          `Config ${dto.configId} has quantities but status is '${config.status}'. ` +
          `Auto-marking as reviewed before creating quotation.`
        );
        await this.configService.markReviewed(dto.configId);
        // Reload config to get updated status
        const updatedConfig = await this.configService.getConfig(dto.configId);
        if (updatedConfig.status !== 'reviewed') {
          throw new BadRequestException(
            `Failed to mark configuration as reviewed. Current status: '${updatedConfig.status}'. ` +
            `Please try again.`
          );
        }
      } else {
        throw new BadRequestException(
          `Configuration must be calculated and reviewed before creating a quotation. ` +
          `Current status: '${config.status}'. Please complete the quantity review first.`
        );
      }
    }

    // Build quotation items from quantities
    const items: Partial<QuotationItem>[] = quantities.map((q) => {
      const qty = q.adjustedQuantity ?? q.calculatedQuantity;
      const price = Number(q.unitPrice) || 0;
      return {
        componentType: q.componentType,
        componentName: q.componentName,
        sizeSpec: q.sizeSpec,
        unit: q.unit,
        quantity: qty,
        unitPrice: price,
        lineTotal: qty * price,
        sortOrder: q.sortOrder,
      };
    });

    // Calculate material subtotal (quantity × price)
    const materialSubtotal = items.reduce((sum, item) => sum + (item.lineTotal || 0), 0);

    // Create quotation first
    const quotation = this.quotationRepo.create({
      projectId: dto.projectId,
      configId: dto.configId,
      rentalStartDate: new Date(dto.rentalStartDate),
      rentalEndDate: new Date(dto.rentalEndDate),
      rentalType: dto.rentalType,
      materialSubtotal,
      costSubtotal: 0, // Will be calculated below
      subtotal: materialSubtotal, // Temporary, will be recalculated
      taxAmount: 0,
      totalAmount: 0,
      status: 'draft',
      createdBy: userId,
    });

    const savedQuotation = await this.quotationRepo.save(quotation);

    // Save material items
    const itemEntities = items.map((item) =>
      this.itemRepo.create({
        ...item,
        quotationId: savedQuotation.id,
      }),
    );
    await this.itemRepo.save(itemEntities);

    // Calculate rental period-based costs (6 categories)
    // Get total components and actual scaffold area from calculation result
    const calcResult = config.calculationResult;
    if (!calcResult) {
      this.logger.warn(`Config ${dto.configId} has no calculationResult. Using defaults for cost calculation.`);
    }
    const totalComponents = quantities.reduce((sum, q) => sum + (q.adjustedQuantity ?? q.calculatedQuantity), 0);

    // Calculate actual scaffold area (m²) from wall dimensions
    const totalArea = (calcResult?.walls || []).reduce((sum: number, wall: any) => {
      const wallLengthM = (wall.wallLengthMm || 0) / 1000;
      const scaffoldHeightM = ((wall.levelCalc?.fullLevels || 0) * 1800) / 1000;
      return sum + wallLengthM * scaffoldHeightM;
    }, 0);
    this.logger.log(`Cost calculation inputs: totalComponents=${totalComponents}, totalArea=${totalArea.toFixed(1)}m²`);

    // Calculate all 6 cost categories
    const costItems = await this.costService.calculateCosts(
      savedQuotation,
      materialSubtotal,
      totalComponents,
      totalArea,
      userId, // Using userId as companyId for now (should get from user context)
    );

    // Calculate cost subtotal
    const costSubtotal = costItems.reduce((sum, item) => sum + Number(item.calculatedValue || item.userEditedValue || 0), 0);

    // Update quotation with totals
    savedQuotation.costSubtotal = costSubtotal;
    savedQuotation.subtotal = materialSubtotal + costSubtotal;
    savedQuotation.taxAmount = Math.floor(savedQuotation.subtotal * 0.1); // 10% consumption tax
    savedQuotation.totalAmount = savedQuotation.subtotal + savedQuotation.taxAmount;
    await this.quotationRepo.save(savedQuotation);

    this.logger.log(
      `Quotation ${savedQuotation.id} created: ${itemEntities.length} material items, ${costItems.length} cost items. ` +
      `Material: ¥${materialSubtotal.toLocaleString()}, Costs: ¥${costSubtotal.toLocaleString()}, Total: ¥${savedQuotation.totalAmount.toLocaleString()}`
    );

    return await this.get(savedQuotation.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : '';
      
      this.logger.error(
        `Failed to create quotation: ${errorMessage}`,
        errorStack,
        `ConfigId: ${dto.configId}, ProjectId: ${dto.projectId}, UserId: ${userId}`
      );
      
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      // Re-throw as InternalServerErrorException for actual server errors
      // This will be caught by the global exception filter
      throw new InternalServerErrorException(
        `Failed to create quotation: ${errorMessage}. Please check the logs for details.`
      );
    }
  }

  async get(id: string): Promise<Quotation> {
    const quotation = await this.quotationRepo.findOne({
      where: { id },
      relations: ['items', 'costItems', 'config', 'config.drawing'],
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    return quotation;
  }

  async list(projectId?: string): Promise<Quotation[]> {
    const query = this.quotationRepo.createQueryBuilder('q')
      .leftJoinAndSelect('q.items', 'items')
      .leftJoinAndSelect('q.costItems', 'costItems')
      .leftJoinAndSelect('q.config', 'config');
    if (projectId) {
      query.where('q.projectId = :projectId', { projectId });
    }
    query.orderBy('q.createdAt', 'DESC');
    return await query.getMany();
  }

  async updateItemPrice(itemId: string, unitPrice: number): Promise<QuotationItem> {
    const item = await this.itemRepo.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Quotation item not found');

    item.unitPrice = unitPrice;
    item.lineTotal = item.quantity * unitPrice;
    const savedItem = await this.itemRepo.save(item);

    // Recalculate quotation totals
    await this.recalculateTotals(item.quotationId);

    return savedItem;
  }

  /**
   * Re-populate unit prices from the materials master for an existing quotation.
   * Also recalculates the 6 cost items using the new materialSubtotal.
   */
  async repopulatePrices(quotationId: string, userId: string): Promise<Quotation> {
    const quotation = await this.get(quotationId);

    if (quotation.status === 'finalized') {
      throw new BadRequestException('Cannot update prices on a finalized quotation.');
    }

    // Get the config to access quantities with materialCodes
    const config = await this.configService.getConfig(quotation.configId);
    const quantities = await this.configService.getQuantities(quotation.configId);

    // Build price map from materials master
    const materials = await this.configService.listMaterials();
    const priceMap = new Map<string, number>();
    for (const m of materials) {
      if (m.code && Number(m.rentalPriceMonthly) > 0) {
        priceMap.set(m.code, Number(m.rentalPriceMonthly));
      }
    }

    if (priceMap.size === 0) {
      throw new BadRequestException(
        'No material prices found. Please set up prices in the Price Settings (単価設定) page first.'
      );
    }

    // Build a lookup from componentType+sizeSpec → materialCode using the calculation result
    const calcResult = config.calculationResult;
    const codeMap = new Map<string, string>();
    if (calcResult?.summary) {
      for (const comp of calcResult.summary) {
        if (comp.materialCode) {
          codeMap.set(`${comp.type}|${comp.sizeSpec}`, comp.materialCode);
        }
      }
    }
    // Also build from quantities (if they have materialCode-like info in componentType)
    for (const q of quantities) {
      if (!codeMap.has(`${q.componentType}|${q.sizeSpec}`)) {
        // Try to infer materialCode from component data
        const key = `${q.componentType}|${q.sizeSpec}`;
        // Match by trying known patterns
        for (const [code] of priceMap) {
          if (code.toLowerCase().includes(q.componentType.toLowerCase())) {
            codeMap.set(key, code);
            break;
          }
        }
      }
    }

    // Update each quotation item's price (batch — single save call)
    let updatedCount = 0;
    const itemsToSave: QuotationItem[] = [];
    for (const item of quotation.items) {
      const key = `${item.componentType}|${item.sizeSpec}`;
      const materialCode = codeMap.get(key);
      if (materialCode && priceMap.has(materialCode)) {
        const newPrice = priceMap.get(materialCode)!;
        item.unitPrice = newPrice;
        item.lineTotal = item.quantity * newPrice;
        itemsToSave.push(item);
        updatedCount++;
      }
    }

    // Single batch save instead of N individual saves
    if (itemsToSave.length > 0) {
      await this.itemRepo.save(itemsToSave);
    }

    this.logger.log(
      `Repopulated prices for quotation ${quotationId}: ${updatedCount}/${quotation.items.length} items updated from materials master`
    );

    // Recalculate material subtotal from the items we just updated (no need to reload from DB)
    const materialSubtotal = quotation.items.reduce((sum, i) => sum + Number(i.lineTotal), 0);

    // Delete old cost items and recalculate
    await this.costItemRepo.delete({ quotationId });

    const totalComponents = quotation.items.reduce((sum, i) => sum + i.quantity, 0);
    const totalArea = (calcResult?.walls || []).reduce((sum: number, wall: any) => {
      const wallLengthM = (wall.wallLengthMm || 0) / 1000;
      const scaffoldHeightM = ((wall.levelCalc?.fullLevels || 0) * 1800) / 1000;
      return sum + wallLengthM * scaffoldHeightM;
    }, 0);

    // Recalculate all 6 cost categories with new materialSubtotal
    const costItems = await this.costService.calculateCosts(
      quotation,
      materialSubtotal,
      totalComponents,
      totalArea,
      userId,
    );

    const costSubtotal = costItems.reduce((sum, item) => sum + Number(item.calculatedValue || 0), 0);

    // Update quotation totals
    const subtotal = materialSubtotal + costSubtotal;
    const taxAmount = Math.floor(subtotal * 0.1);
    const totalAmount = subtotal + taxAmount;

    await this.quotationRepo.update(quotationId, {
      materialSubtotal,
      costSubtotal,
      subtotal,
      taxAmount,
      totalAmount,
    });

    this.logger.log(
      `Quotation ${quotationId} repopulated: Material ¥${materialSubtotal.toLocaleString()}, ` +
      `Costs ¥${costSubtotal.toLocaleString()}, Total ¥${totalAmount.toLocaleString()}`
    );

    return await this.get(quotationId);
  }

  async finalize(id: string): Promise<Quotation> {
    const quotation = await this.get(id);
    quotation.status = 'finalized';
    quotation.finalizedAt = new Date();
    return await this.quotationRepo.save(quotation);
  }

  private async recalculateTotals(quotationId: string): Promise<void> {
    const quotation = await this.get(quotationId);
    const materialSubtotal = quotation.items.reduce((sum, i) => sum + Number(i.lineTotal), 0);
    const costSubtotal = quotation.costItems.reduce((sum, i) => sum + Number(i.calculatedValue || i.userEditedValue || 0), 0);
    const subtotal = materialSubtotal + costSubtotal;
    const taxAmount = Math.floor(subtotal * 0.1);
    const totalAmount = subtotal + taxAmount;

    await this.quotationRepo.update(quotationId, { materialSubtotal, costSubtotal, subtotal, taxAmount, totalAmount });
  }
}
