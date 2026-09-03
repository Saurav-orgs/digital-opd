'use strict';

/**
 * A shared reference list of well-known medicines.
 *
 * Owned by nobody (`doctor_id IS NULL`), so every clinic sees it alongside its
 * own vocabulary, and no clinic's prescribing habits leak into another's.
 *
 * It exists because of the way dictation fails. Whisper is primed with the
 * medicine names we hand it; a drug it has never been primed with comes back
 * as whatever ordinary word sounds closest — "Mounjaro" is heard as "Munger",
 * which looks entirely plausible sitting in a list of medicines. The editor
 * can only offer "did you mean Mounjaro?" if something in the catalogue says
 * Mounjaro, and a catalogue that only learns from issued prescriptions cannot
 * know a name until after it has already been got wrong once.
 *
 * Deliberately generics and long-established brands rather than an exhaustive
 * drug database: these are a spelling and sound-alike reference, not a
 * formulary, and nothing here is dosing advice. `usage_count` stays 0 so a
 * clinic's real habits always outrank the list.
 */

const GENERICS = [
  // Analgesia, antipyretics, anti-inflammatories
  'Paracetamol', 'Ibuprofen', 'Aspirin', 'Diclofenac', 'Aceclofenac', 'Naproxen',
  'Etoricoxib', 'Celecoxib', 'Indomethacin', 'Piroxicam', 'Nimesulide',
  'Tramadol', 'Tapentadol', 'Codeine', 'Morphine', 'Mefenamic Acid',
  // Antibiotics and anti-infectives
  'Amoxicillin', 'Amoxicillin-Clavulanate', 'Ampicillin', 'Cloxacillin',
  'Azithromycin', 'Clarithromycin', 'Erythromycin', 'Cefixime', 'Cefpodoxime',
  'Cefuroxime', 'Ceftriaxone', 'Cephalexin', 'Cefadroxil', 'Ciprofloxacin',
  'Levofloxacin', 'Ofloxacin', 'Norfloxacin', 'Moxifloxacin', 'Doxycycline',
  'Minocycline', 'Metronidazole', 'Ornidazole', 'Tinidazole', 'Nitrofurantoin',
  'Linezolid', 'Clindamycin', 'Vancomycin', 'Meropenem', 'Piperacillin-Tazobactam',
  'Rifampicin', 'Isoniazid', 'Pyrazinamide', 'Ethambutol',
  // Antifungals, antivirals, antiparasitics
  'Fluconazole', 'Itraconazole', 'Terbinafine', 'Ketoconazole', 'Griseofulvin',
  'Acyclovir', 'Valacyclovir', 'Oseltamivir', 'Albendazole', 'Mebendazole',
  'Ivermectin', 'Hydroxychloroquine', 'Chloroquine', 'Artemether-Lumefantrine',
  'Primaquine',
  // Diabetes
  'Metformin', 'Glimepiride', 'Gliclazide', 'Glipizide', 'Glibenclamide',
  'Sitagliptin', 'Vildagliptin', 'Linagliptin', 'Teneligliptin', 'Saxagliptin',
  'Dapagliflozin', 'Empagliflozin', 'Canagliflozin', 'Pioglitazone', 'Acarbose',
  'Voglibose', 'Insulin Glargine', 'Insulin Aspart', 'Insulin Lispro',
  'Insulin Degludec', 'Human Insulin',
  // GLP-1 and related — newest, least likely to be heard correctly
  'Semaglutide', 'Tirzepatide', 'Liraglutide', 'Dulaglutide', 'Exenatide',
  // Cardiovascular
  'Atorvastatin', 'Rosuvastatin', 'Simvastatin', 'Fenofibrate', 'Ezetimibe',
  'Amlodipine', 'Nifedipine', 'Cilnidipine', 'Telmisartan', 'Losartan',
  'Olmesartan', 'Valsartan', 'Irbesartan', 'Ramipril', 'Enalapril', 'Lisinopril',
  'Metoprolol', 'Bisoprolol', 'Atenolol', 'Carvedilol', 'Nebivolol',
  'Propranolol', 'Clonidine', 'Prazosin', 'Hydrochlorothiazide', 'Chlorthalidone',
  'Indapamide', 'Furosemide', 'Torsemide', 'Spironolactone', 'Clopidogrel',
  'Ticagrelor', 'Prasugrel', 'Warfarin', 'Acenocoumarol', 'Apixaban',
  'Rivaroxaban', 'Dabigatran', 'Digoxin', 'Ivabradine', 'Ranolazine',
  'Isosorbide Mononitrate', 'Isosorbide Dinitrate', 'Nitroglycerin', 'Trimetazidine',
  // Gastrointestinal
  'Omeprazole', 'Pantoprazole', 'Rabeprazole', 'Esomeprazole', 'Lansoprazole',
  'Famotidine', 'Ranitidine', 'Sucralfate', 'Domperidone', 'Ondansetron',
  'Metoclopramide', 'Itopride', 'Levosulpiride', 'Dicyclomine', 'Drotaverine',
  'Mebeverine', 'Lactulose', 'Bisacodyl', 'Ispaghula Husk', 'Polyethylene Glycol',
  'Loperamide', 'Racecadotril', 'Rifaximin', 'Mesalamine', 'Ursodeoxycholic Acid',
  'Oral Rehydration Salts',
  // Respiratory and allergy
  'Salbutamol', 'Levosalbutamol', 'Formoterol', 'Salmeterol', 'Budesonide',
  'Fluticasone', 'Ciclesonide', 'Ipratropium', 'Tiotropium', 'Montelukast',
  'Theophylline', 'Doxofylline', 'Cetirizine', 'Levocetirizine', 'Fexofenadine',
  'Loratadine', 'Desloratadine', 'Bilastine', 'Chlorpheniramine', 'Hydroxyzine',
  'Ambroxol', 'Bromhexine', 'Guaifenesin', 'Dextromethorphan', 'Acetylcysteine',
  // Neurology and psychiatry
  'Amitriptyline', 'Nortriptyline', 'Sertraline', 'Escitalopram', 'Fluoxetine',
  'Paroxetine', 'Venlafaxine', 'Desvenlafaxine', 'Duloxetine', 'Mirtazapine',
  'Bupropion', 'Vortioxetine', 'Alprazolam', 'Clonazepam', 'Lorazepam',
  'Diazepam', 'Etizolam', 'Zolpidem', 'Quetiapine', 'Olanzapine', 'Risperidone',
  'Aripiprazole', 'Haloperidol', 'Lithium Carbonate', 'Sodium Valproate',
  'Levetiracetam', 'Carbamazepine', 'Oxcarbazepine', 'Phenytoin', 'Lamotrigine',
  'Topiramate', 'Gabapentin', 'Pregabalin', 'Sumatriptan', 'Rizatriptan',
  'Naratriptan', 'Flunarizine', 'Donepezil', 'Memantine', 'Levodopa-Carbidopa',
  'Pramipexole', 'Ropinirole', 'Baclofen', 'Tizanidine', 'Thiocolchicoside',
  'Chlorzoxazone', 'Betahistine', 'Cinnarizine',
  // Steroids, immunology, gout
  'Prednisolone', 'Methylprednisolone', 'Dexamethasone', 'Hydrocortisone',
  'Deflazacort', 'Betamethasone', 'Colchicine', 'Febuxostat', 'Allopurinol',
  'Methotrexate', 'Sulfasalazine', 'Leflunomide', 'Azathioprine', 'Mycophenolate',
  // Endocrine and urology
  'Levothyroxine', 'Carbimazole', 'Methimazole', 'Propylthiouracil',
  'Medroxyprogesterone', 'Progesterone', 'Estradiol', 'Clomiphene', 'Letrozole',
  'Testosterone', 'Tamsulosin', 'Silodosin', 'Alfuzosin', 'Finasteride',
  'Dutasteride', 'Sildenafil', 'Tadalafil', 'Oxybutynin', 'Solifenacin',
  'Mirabegron', 'Potassium Citrate',
  // Vitamins, minerals, supplements
  'Cholecalciferol', 'Calcitriol', 'Methylcobalamin', 'Cyanocobalamin',
  'Folic Acid', 'Ferrous Sulphate', 'Ferrous Ascorbate', 'Ferrous Fumarate',
  'Calcium Carbonate', 'Calcium Citrate', 'Zinc Sulphate', 'Ascorbic Acid',
  'Thiamine', 'Pyridoxine', 'Multivitamin', 'Omega-3 Fatty Acids',
  // Topical and ophthalmic
  'Mupirocin', 'Fusidic Acid', 'Clotrimazole', 'Miconazole', 'Permethrin',
  'Silver Sulfadiazine', 'Neosporin', 'Tobramycin', 'Moxifloxacin Eye Drops',
  'Carboxymethylcellulose', 'Olopatadine',
];

/**
 * Brands a doctor is far more likely to say out loud than the generic, so
 * these are the ones dictation most needs primed. Long-established Indian
 * brands, plus the newer injectables whose names dictation has no chance with.
 */
const BRANDS = [
  'Dolo', 'Crocin', 'Calpol', 'Combiflam', 'Zerodol', 'Ultracet', 'Tramazac',
  'Etoshine', 'Enzoflam', 'Voveran', 'Brufen',
  'Augmentin', 'Clavam', 'Azee', 'Azithral', 'Zifi', 'Taxim', 'Monocef',
  'Cifran', 'Levoflox', 'Norflox', 'Flagyl', 'Metrogyl', 'Zenflox',
  'Pan', 'Pan-D', 'Pantocid', 'Razo', 'Omez', 'Rantac', 'Aciloc', 'Zinetac',
  'Digene', 'Gelusil', 'Cyclopam', 'Meftal', 'Emeset', 'Perinorm',
  'Allegra', 'Cetzine', 'Avil', 'Montair', 'Montek', 'Ascoril', 'Asthalin',
  'Foracort', 'Seroflo', 'Duolin', 'Budecort', 'Sinarest', 'Cheston',
  'Glycomet', 'Janumet', 'Januvia', 'Galvus', 'Galvus Met', 'Istamet', 'Amaryl',
  'Zoryl', 'Lantus', 'Basalog', 'Huminsulin', 'Mixtard', 'Ryzodeg', 'Tresiba',
  'Mounjaro', 'Ozempic', 'Rybelsus', 'Wegovy', 'Trulicity', 'Victoza', 'Saxenda',
  'Ecosprin', 'Clopilet', 'Deplatt', 'Storvas', 'Atorva', 'Rosuvas', 'Crestor',
  'Telma', 'Telma-H', 'Losar', 'Olmesar', 'Amlong', 'Stamlo', 'Concor',
  'Metolar', 'Nebicard', 'Dytor', 'Lasix', 'Aldactone', 'Cardivas',
  'Thyronorm', 'Eltroxin', 'Thyrox',
  'Shelcal', 'Neurobion', 'Becosules', 'Limcee', 'Zincovit', 'Uprise D3',
  'Omnacortil', 'Wysolone', 'Medrol', 'Defcort',
  'Lyrica', 'Gabapin', 'Pregabid', 'Nexito', 'Cipralex', 'Restyl', 'Etilaam',
  'Urimax', 'Veltam', 'Dutas',
];

const NAMES = [...GENERICS, ...BRANDS];

module.exports = {
  async up(queryInterface) {
    // Idempotent: safe to re-run, and safe on a database where a clinic has
    // already created some of these names for itself. Only rows that nobody
    // owns are touched, and only names not already shared.
    await queryInterface.sequelize.query(
      `INSERT INTO medicine_catalog (id, name, doctor_id, usage_count, created_at, updated_at)
       SELECT gen_random_uuid(), candidate, NULL, 0, now(), now()
         FROM unnest(ARRAY[:names]::text[]) AS candidate
        WHERE NOT EXISTS (
              SELECT 1 FROM medicine_catalog existing
               WHERE existing.doctor_id IS NULL
                 AND lower(existing.name) = lower(candidate)
        )`,
      { replacements: { names: NAMES } },
    );
  },

  async down(queryInterface) {
    // Only the shared rows this seeder could have created. A clinic's own
    // catalogue is its record of what it has prescribed and is never touched.
    await queryInterface.sequelize.query(
      `DELETE FROM medicine_catalog
             WHERE doctor_id IS NULL
               AND lower(name) = ANY (SELECT lower(n) FROM unnest(ARRAY[:names]::text[]) AS n)`,
      { replacements: { names: NAMES } },
    );
  },
};
