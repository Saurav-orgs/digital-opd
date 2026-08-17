# OPD Patient App (Flutter)

Guest-booking mobile app for the OPD Appointment Booking System.
See the [technical plan](../opd-appointment-system-plan.md) and [task board](../TASKS.md).

## Stack
- **Flutter** (Material 3), **google_fonts** (Inter) — Calm Clinical theme (plan §15)
- **http** + **http_parser** for the API (envelope unwrap + readable errors)
- **image_picker** for the payment screenshot
- No login — patient booking is guest-based, keyed on mobile number

## Flow
Doctor list (enabled only) → Doctor detail (date strip today→+7, **split-session slot grid**:
available / booked / past) → Booking form (mobile*, name*, address, reason, **QR display**, **screenshot upload ≤ 5 MB**)
→ Confirmation.

## Run

The backend (`../backend-OPD`) must be running on `:3000`.

```bash
flutter pub get
flutter run                 # iOS simulator / desktop reach the host via localhost
```

- **iOS simulator / desktop:** `localhost:3000` works out of the box.
- **Android emulator:** the app auto-uses `10.0.2.2:3000`.
- **Physical device / custom host:** `flutter run --dart-define=API_BASE_URL=http://<host>:3000/api`

## Structure
```
lib/
  main.dart                 app entry + theme
  theme.dart                Calm Clinical ThemeData + AppColors
  config.dart               API base URL + booking constants
  api/
    api_client.dart         http wrapper, ApiException, endpoints
    models.dart             Doctor, Slot, DaySlots, BookingResult
  widgets/common.dart       NetworkAvatar, SectionCard, StateView, snackbar
  screens/
    doctor_list_screen.dart
    doctor_detail_screen.dart   date strip + slot grid
    booking_form_screen.dart    form + QR + screenshot upload
    confirmation_screen.dart
```

## Notes
- Slots are marked `past` using the clinic timezone from the backend; booked & past slots are non-selectable.
- Errors show the backend's readable `message`; `SLOT_ALREADY_BOOKED` / `SLOT_IN_PAST` bounce the user back to re-pick.
- The screenshot part sets an image mime (`image/jpeg|png|webp`) so it passes the backend's upload allowlist.
- iOS requires `NSPhotoLibraryUsageDescription` + `NSAllowsLocalNetworking` (already set in `ios/Runner/Info.plist`).
