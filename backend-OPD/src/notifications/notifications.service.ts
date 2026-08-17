import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Notification } from '../database/models/notification.model';
import { NotificationType } from '../common/enums';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification) private readonly notificationModel: typeof Notification,
  ) {}

  async create(
    mobile: string,
    type: NotificationType,
    title: string,
    body?: string,
    data?: Record<string, unknown>,
  ): Promise<Notification> {
    return this.notificationModel.create({
      patient_mobile: mobile,
      type,
      title,
      body: body ?? null,
      data: data ?? null,
      read_at: null,
    } as any);
  }

  async listForPatient(mobile: string): Promise<Notification[]> {
    return this.notificationModel.findAll({
      where: { patient_mobile: mobile },
      order: [['created_at', 'DESC']],
    });
  }

  async unreadCount(mobile: string): Promise<number> {
    return this.notificationModel.count({
      where: { patient_mobile: mobile, read_at: null },
    });
  }

  async markRead(mobile: string, id: string): Promise<void> {
    await this.notificationModel.update(
      { read_at: new Date() },
      { where: { id, patient_mobile: mobile, read_at: null } },
    );
  }

  async markAllRead(mobile: string): Promise<void> {
    await this.notificationModel.update(
      { read_at: new Date() },
      { where: { patient_mobile: mobile, read_at: null } },
    );
  }
}
