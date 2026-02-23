import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
  JoinColumn,
} from 'typeorm';
import { Drawing } from './drawing.entity';

export type GeometryElementType = 'line' | 'polyline' | 'arc' | 'circle' | 'polygon' | 'text' | 'dimension';

@Entity('geometry_elements')
@Index(['drawingId', 'layerName'])
export class GeometryElement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'drawing_id' })
  drawingId: string;

  @ManyToOne(() => Drawing, (drawing) => drawing.geometryElements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'drawing_id' })
  drawing: Drawing;

  @Column({ type: 'enum', enum: ['line', 'polyline', 'arc', 'circle', 'polygon', 'text', 'dimension'], name: 'element_type' })
  elementType: GeometryElementType;

  @Column({ type: 'jsonb' })
  coordinates: number[][]; // array of [x, y] points

  @Column({ name: 'layer_name', nullable: true })
  layerName: string;

  @Column({ type: 'jsonb', nullable: true })
  properties: Record<string, any>;

  @Column({ name: 'extracted_length', type: 'decimal', precision: 10, scale: 2, nullable: true })
  extractedLength: number;

  @Column({ name: 'extracted_area', type: 'decimal', precision: 15, scale: 2, nullable: true })
  extractedArea: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
