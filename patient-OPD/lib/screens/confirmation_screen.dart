import 'package:flutter/material.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';

class ConfirmationScreen extends StatelessWidget {
  final BookingResult result;
  final Doctor doctor;
  const ConfirmationScreen({
    super.key,
    required this.result,
    required this.doctor,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Spacer(),
              Container(
                width: 84,
                height: 84,
                decoration: const BoxDecoration(
                  color: AppColors.secondaryTint,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.check_rounded,
                    color: AppColors.secondary, size: 46),
              ),
              const SizedBox(height: 20),
              const Text('Booking confirmed',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w500)),
              const SizedBox(height: 8),
              Text(
                'Your appointment with ${result.doctorName ?? doctor.name} is confirmed.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textSecondary, height: 1.4),
              ),
              const SizedBox(height: 24),
              SectionCard(
                child: Column(
                  children: [
                    _row('Doctor', result.doctorName ?? doctor.name),
                    const Divider(height: 20),
                    _row('Date', result.appointmentDate),
                    const Divider(height: 20),
                    _row('Time', '${result.startTime}–${result.endTime}'),
                    const Divider(height: 20),
                    _row('Patient', result.patientName),
                    const Divider(height: 20),
                    _row('Reference', result.id.substring(0, 8).toUpperCase()),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Payment will be verified by the clinic. Please arrive a few minutes early.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: ElevatedButton(
                  onPressed: () => Navigator.of(context)
                      .popUntil((route) => route.isFirst),
                  child: const Text('Back to doctors'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _row(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: AppColors.textSecondary)),
        Flexible(
          child: Text(value,
              textAlign: TextAlign.right,
              style: const TextStyle(fontWeight: FontWeight.w500)),
        ),
      ],
    );
  }
}
