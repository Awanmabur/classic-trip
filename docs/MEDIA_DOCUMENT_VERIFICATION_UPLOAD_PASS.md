# Media / Document / Verification Upload Pass

This pass expands the existing company media upload path into a broader company-scoped media and verification workflow.

## Added upload targets

- Company logo
- Company cover/banner
- Company business/tax/verification documents
- Bus listing media
- Vehicle photos
- Vehicle registration / insurance / compliance documents
- Driver license / ID documents
- Hotel listing media
- Hotel property photos/documents
- Room type photos
- Room unit media
- Guest identity documents

## Dashboard UI

A new Media & verification uploads panel was added to the Company Profile page. It supports selecting an upload target, linking the upload to a related listing/vehicle/driver/property/room type/room unit, selecting document type, adding a reference, adding a note, and uploading an image or PDF.

Company review documents are shown with status, reference, and view links.

## Backend

- Extended `src/controllers/company/mediaController.js` target handling.
- Extended `src/services/media/uploadService.js` folder mapping and resource type handling.
- Extended `companyService.attachMedia` and `removeMedia` for vehicle, driver, hotel property, room type, room unit, and guest documents.
- Added driver and company verification sync on document upload.
- Added `mediaReviewService` for Super Admin document approval/rejection.
- Added admin route `POST /admin/media-documents/:targetType/:targetId/:publicId/review`.
- Added room unit media/document schema support.

## Validation

Ran:

```bash
npm run check
npm run check:dashboards
npm run check:dashboard-smoke-static
```
