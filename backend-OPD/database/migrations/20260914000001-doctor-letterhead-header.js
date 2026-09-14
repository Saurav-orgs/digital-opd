'use strict';

/**
 * A doctor-supplied prescription header.
 *
 * Instead of the PDF composing a header out of name, qualifications and
 * address, the doctor can upload the header of their own pad as one image.
 * It is drawn into a fixed box at the top of the page (see
 * `prescription-pdf.service.ts`); when unset the composed header still
 * prints, so nothing changes for a doctor who uploads nothing.
 *
 * Table touched:
 *   doctors — add letterhead_header_key (S3 key of the image).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('doctors', 'letterhead_header_key', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('doctors', 'letterhead_header_key');
  },
};
