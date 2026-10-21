-- Platform and transport are independent. Existing FCM registrations are Android.
ALTER TABLE mobile_push_registration ADD COLUMN platform TEXT NOT NULL DEFAULT 'android'
  CHECK(platform IN ('ios','android'));
-- Do not reinterpret APNs device tokens as FCM tokens. Retire only push material;
-- installation identity, queue entries and owner-only notice resolution are untouched.
UPDATE mobile_push_outbox SET status='discarded',last_error='transport_migration'
WHERE status IN ('pending','sending') AND installation_hash IN
  (SELECT installation_hash FROM mobile_push_registration WHERE provider='apns');
DELETE FROM mobile_push_registration WHERE provider='apns';
