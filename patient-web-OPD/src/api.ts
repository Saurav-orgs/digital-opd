import axios, { AxiosError } from 'axios';
import { AppConfig } from './config';
import type { Doctor, DaySlots, BookingResult } from './types';
import { ApiException } from './types';

const client = axios.create({
  baseURL: AppConfig.apiBaseUrl,
  timeout: 15000,
});

function handleAxiosError(err: unknown): never {
  if (axios.isAxiosError(err)) {
    const error = err as AxiosError<any>;
    if (!error.response) {
      throw new ApiException(
        'NETWORK_ERROR',
        'Unable to reach the server. Check your connection.',
        0
      );
    }
    const data = error.response.data;
    if (data && typeof data === 'object') {
      throw new ApiException(
        data.error || 'ERROR',
        data.message || 'Something went wrong. Please try again.',
        error.response.status,
        data.details
      );
    }
    throw new ApiException('ERROR', 'Something went wrong.', error.response.status);
  }
  throw new ApiException('ERROR', 'Unexpected error occurred.', 0);
}

export const api = {
  async listDoctors(): Promise<Doctor[]> {
    try {
      const res = await client.get('/public/doctors');
      const rawList = res.data.data ?? res.data;
      return rawList.map((d: any) => ({
        id: d.id,
        name: d.name,
        specialization: d.specialization,
        qualifications: d.qualifications,
        bio: d.bio,
        consultationFee: d.consultation_fee != null ? String(d.consultation_fee) : null,
        profilePhotoUrl: d.profile_photo_url,
        publicSlug: d.public_slug || '',
      }));
    } catch (err) {
      handleAxiosError(err);
    }
  },

  async doctorByIdOrSlug(idOrSlug: string): Promise<Doctor> {
    try {
      const res = await client.get(`/public/doctors/${idOrSlug}`);
      const d = res.data.data ?? res.data;
      return {
        id: d.id,
        name: d.name,
        specialization: d.specialization,
        qualifications: d.qualifications,
        bio: d.bio,
        consultationFee: d.consultation_fee != null ? String(d.consultation_fee) : null,
        profilePhotoUrl: d.profile_photo_url,
        publicSlug: d.public_slug || '',
      };
    } catch (err) {
      handleAxiosError(err);
    }
  },

  async getSlots(doctorId: string, date: string): Promise<DaySlots> {
    try {
      const res = await client.get(`/public/doctors/${doctorId}/slots`, {
        params: { date },
      });
      const data = res.data.data ?? res.data;
      return {
        date: data.date,
        available: data.available ?? false,
        reason: data.reason,
        slots: (data.slots || []).map((s: any) => ({
          startTime: s.start_time,
          endTime: s.end_time,
          status: s.status === 'booked' ? 'booked' : s.status === 'past' ? 'past' : 'available',
          selectable: s.status === 'available' || s.status === undefined,
        })),
      };
    } catch (err) {
      handleAxiosError(err);
    }
  },

  async bookAppointment(params: {
    doctorId: string;
    date: string;
    startTime: string;
    /** Omit to register a new patient from the details below. */
    patientProfileId?: string | null;
    patientName: string;
    patientMobile: string;
    patientGender: string;
    patientAge: number;
    patientAddress: string;
    patientCity: string;
    patientState: string;
    patientPincode: string;
    description?: string;
  }): Promise<BookingResult> {
    try {
      // Payment is handled in person at the clinic, so the booking is a plain
      // JSON request with no screenshot.
      const res = await client.post('/public/appointments', {
        doctor_id: params.doctorId,
        appointment_date: params.date,
        start_time: params.startTime,
        patient_name: params.patientName,
        patient_mobile: params.patientMobile,
        patient_gender: params.patientGender,
        patient_age: params.patientAge,
        // Present = "this existing patient"; absent = "a new patient", even if
        // the name matches one already on the number.
        ...(params.patientProfileId
          ? { patient_profile_id: params.patientProfileId }
          : {}),
        patient_address: params.patientAddress.trim(),
        patient_city: params.patientCity.trim(),
        patient_state: params.patientState.trim(),
        patient_pincode: params.patientPincode.trim(),
        ...(params.description?.trim()
          ? { description: params.description.trim() }
          : {}),
      });

      const data = res.data.data ?? res.data;
      return {
        id: data.id,
        appointmentDate: data.appointment_date,
        startTime: (data.start_time || '').slice(0, 5),
        endTime: (data.end_time || '').slice(0, 5),
        patientName: data.patient_name,
        doctorName: data.doctor?.name || null,
      };
    } catch (err) {
      handleAxiosError(err);
    }
  },
};
