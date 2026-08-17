import 'package:flutter/material.dart';
import '../theme.dart';

/// Rounded network image with graceful loading + fallback.
class NetworkAvatar extends StatelessWidget {
  final String? url;
  final double size;
  final IconData fallback;
  const NetworkAvatar({
    super.key,
    required this.url,
    this.size = 56,
    this.fallback = Icons.person,
  });

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: AppColors.primaryTint,
        borderRadius: BorderRadius.circular(size / 4),
      ),
      child: Icon(fallback, color: AppColors.primary, size: size * 0.5),
    );
    if (url == null || url!.isEmpty) return placeholder;
    return ClipRRect(
      borderRadius: BorderRadius.circular(size / 4),
      child: Image.network(
        url!,
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => placeholder,
        loadingBuilder: (c, child, progress) =>
            progress == null ? child : placeholder,
      ),
    );
  }
}

/// A soft-outlined section card matching the Calm Clinical look.
class SectionCard extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  const SectionCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: child,
    );
  }
}

/// Full-screen state (loading / error / empty).
class StateView extends StatelessWidget {
  final bool loading;
  final String? error;
  final VoidCallback? onRetry;
  final String? empty;
  const StateView({super.key, this.loading = false, this.error, this.onRetry, this.empty});

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(child: CircularProgressIndicator(strokeWidth: 2.4));
    }
    if (error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: AppColors.error, size: 40),
              const SizedBox(height: 12),
              Text(error!, textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.textSecondary)),
              if (onRetry != null) ...[
                const SizedBox(height: 16),
                OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
              ],
            ],
          ),
        ),
      );
    }
    return Center(
      child: Text(empty ?? 'Nothing here yet.',
          style: const TextStyle(color: AppColors.textSecondary)),
    );
  }
}

enum _Tone { success, warning, danger, neutral, info }

/// Pill badge mapping a status string to a Calm Clinical colour.
class StatusBadge extends StatelessWidget {
  final String value;
  final String? label;
  const StatusBadge(this.value, {super.key, this.label});

  _Tone get _tone => switch (value) {
        'verified' || 'done' || 'confirmed' || 'available' => _Tone.success,
        'paid_unverified' || 'pending' || 'on_hold' => _Tone.warning,
        'rejected' => _Tone.danger,
        'booked' || 'past' => _Tone.neutral,
        _ => _Tone.info,
      };

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (_tone) {
      _Tone.success => (AppColors.secondaryTint, AppColors.secondary),
      _Tone.warning => (const Color(0xFFFBF1E0), AppColors.onHold),
      _Tone.danger => (const Color(0xFFFDECEC), AppColors.error),
      _Tone.neutral => (const Color(0xFFEDEFF2), AppColors.textSecondary),
      _Tone.info => (AppColors.primaryTint, AppColors.primary),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(
        label ?? prettyStatus(value),
        style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w500),
      ),
    );
  }
}

/// "paid_unverified" -> "Paid unverified".
String prettyStatus(String v) {
  if (v.isEmpty) return v;
  final s = v.replaceAll('_', ' ');
  return s[0].toUpperCase() + s.substring(1);
}

/// Sign-out confirm dialog, then invokes [onConfirm]. Shared by the three
/// patient-account screens so each AppBar can offer a sign-out action.
Future<void> confirmSignOut(BuildContext context, Future<void> Function() onConfirm) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: const Text('Sign out?'),
      content: const Text('You will need to login again with your mobile number.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Sign out')),
      ],
    ),
  );
  if (ok == true) await onConfirm();
}

void showErrorSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: AppColors.error,
      behavior: SnackBarBehavior.floating,
    ));
}

void showSuccessSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: AppColors.secondary,
      behavior: SnackBarBehavior.floating,
    ));
}
