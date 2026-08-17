import { Role } from './role.model';
import { Permission } from './permission.model';
import { RolePermission } from './role-permission.model';
import { User } from './user.model';
import { Doctor } from './doctor.model';
import { OpdSchedule } from './opd-schedule.model';
import { ScheduleException } from './schedule-exception.model';
import { Appointment } from './appointment.model';
import { AppointmentPrescription } from './prescription.model';
import { Patient } from './patient.model';
import { PatientReport } from './patient-report.model';
import { Notification } from './notification.model';

export const models = [
  Role,
  Permission,
  RolePermission,
  User,
  Doctor,
  OpdSchedule,
  ScheduleException,
  Appointment,
  AppointmentPrescription,
  Patient,
  PatientReport,
  Notification,
];

export {
  Role,
  Permission,
  RolePermission,
  User,
  Doctor,
  OpdSchedule,
  ScheduleException,
  Appointment,
  AppointmentPrescription,
  Patient,
  PatientReport,
  Notification,
};
