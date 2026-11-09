// Sample data for the mocked backend: realistic, but made up. Used by the
// guide screenshots (shots.js) and the showcase captures (showcase/).
const ago = (n) => new Date(Date.now() - n * 864e5).toISOString();
const day = (n) => ago(n).slice(0, 10);
const P = (sku, upc, style, color, size, desc, tag = '') => ({ SKU: sku, UPC: upc, DEPT: desc.includes("Women") ? 'W' : 'M', 'STYLE SKU': style, COLOR: color, SIZE: size, DESCRIPTION: desc, 'HARD TAG LOCATION': tag });
const DATA = {
  staff: ['LS', 'SC', 'SG', 'JV'],
  master: [
    P('X000009560002', '623555583288', 'X000009560', 'Black', 'S', "Atom SL Hoody Men's", 'Chest Pocket'),
    P('X000009560003', '623555583295', 'X000009560', 'Black', 'M', "Atom SL Hoody Men's", 'Chest Pocket'),
    P('X000009560004', '623555583301', 'X000009560', 'Black', 'L', "Atom SL Hoody Men's", 'Chest Pocket'),
    P('X000009560012', '623555583318', 'X000009560', 'Void', 'M', "Atom SL Hoody Men's", 'Chest Pocket'),
    P('X000007300001', '686487612345', 'X000007300', 'Solace', 'S', "Beta Jacket Women's", 'Hood'),
    P('X000007300002', '686487612352', 'X000007300', 'Solace', 'M', "Beta Jacket Women's", 'Hood'),
    P('X000006700003', '686487698712', 'X000006700', 'Black', '32', "Gamma Pant Men's", 'Left Leg In-seam'),
    P('X000005100001', '686487655501', 'X000005100', 'Graphite', 'M', "Cerium Hoody Men's", ''),
  ],
  auditlog: [
    { id: 'a1', timestamp: ago(1), date: day(1), initials: 'SC', sku: 'X000007300002', upc: '686487612352', style: 'X000007300', description: "Beta Jacket Women's — Solace / M", expected: 12, counted: 7, variance: -5, result: 'under' },
    { id: 'a2', timestamp: ago(1), date: day(1), initials: 'SC', sku: 'X000009560003', upc: '623555583295', style: 'X000009560', description: "Atom SL Hoody Men's — Black / M", expected: 6, counted: 6, variance: 0, result: 'match' },
    { id: 'a3', timestamp: ago(2), date: day(2), initials: 'JV', sku: 'X000006700003', upc: '686487698712', style: 'X000006700', description: "Gamma Pant Men's — Black / 32", expected: 4, counted: 5, variance: 1, result: 'over' },
  ],
  consolmaster: [
    { MATERIAL: "Gamma Pant Men's", COLOR: 'Black', 'STYLE SKU': 'X000006700', 'ECC GENERIC MATERIAL': '30451', DESTINATION: 'Toronto DC', TOTAL: 4, PROCESSED: '' },
    { MATERIAL: "Cerium Hoody Men's", COLOR: 'Graphite', 'STYLE SKU': 'X000005100', 'ECC GENERIC MATERIAL': '30452', DESTINATION: 'Toronto DC', TOTAL: 2, PROCESSED: '' },
    { MATERIAL: "Atom SL Hoody Men's", COLOR: 'Void', 'STYLE SKU': 'X000009560', 'ECC GENERIC MATERIAL': '30453', DESTINATION: 'Toronto DC', TOTAL: 3, PROCESSED: '' },
    { MATERIAL: "Beta Jacket Women's", COLOR: 'Solace', 'STYLE SKU': 'X000007300', 'ECC GENERIC MATERIAL': '30450', DESTINATION: 'Toronto DC', TOTAL: 2, PROCESSED: 'Processed' },
  ],
  consollog: [
    { id: 'c1', entryType: 'packout', timestamp: ago(1), date: day(1), initials: 'SG', referenceNumber: '4410093821' },
    { id: 'c2', entryType: 'status', timestamp: ago(1), date: day(1), initials: 'SG', eccMaterial: '30450', description: "Beta Jacket Women's", color: 'Solace', status: 'Actioned' },
    { id: 'count-30451', entryType: 'count', timestamp: ago(0), date: day(0), initials: 'SG', eccMaterial: '30451', description: "Gamma Pant Men's", color: 'Black', actualCount: 2 },
  ],
  receiving: [
    { barcode: '8069559026403610', po: '6390185302', expectedDate: day(4), physicallyReceivedDate: day(3), physicallyReceivedBy: 'SC', receivedIntoMaoDate: '', receivedIntoMaoBy: '' },
    { barcode: '8069559026403611', po: '6390185303', expectedDate: day(0), physicallyReceivedDate: '', physicallyReceivedBy: '', receivedIntoMaoDate: '', receivedIntoMaoBy: '' },
    { barcode: '8069559026403612', po: '6390185303', expectedDate: day(0), physicallyReceivedDate: '', physicallyReceivedBy: '', receivedIntoMaoDate: '', receivedIntoMaoBy: '' },
    { barcode: '8069559026403599', po: '6390185290', expectedDate: day(6), physicallyReceivedDate: day(5), physicallyReceivedBy: 'LS', receivedIntoMaoDate: day(5), receivedIntoMaoBy: 'LS' },
  ],
  floorrestock: (() => {
    const r = (name, color, size, sku, sold, onHand, extra = {}) => ({ GENDER: 'M', 'CLOTHING CATEGORY': 'Jackets', 'MODEL NAME': name, COLOR: color, SIZE: size, SKU: sku, 'QUANTITY SOLD': sold, 'ON HAND QUANTITY': onHand, STATUS: '', 'CHECKED BY': '', 'CHECKED DATE': '', '86': '', RESTOCKED: '', ...extra });
    return [
      r("Atom Hoody Men's", 'Black', 'S', 'X000009560002', 1, 3), r("Atom Hoody Men's", 'Black', 'M', 'X000009560003', 2, 4), r("Atom Hoody Men's", 'Black', 'L', 'X000009560004', 1, 2),
      r("Atom Hoody Men's", 'Void', 'M', 'X000009560012', 1, 1),
      r("Beta Jacket Women's", 'Solace', 'S', 'X000007300001', 1, 2),
      r("Cormac Tee Men's", 'White', 'L', 'X000004400004', 2, 6),
      r("Gamma Pant Men's", 'Black', '32', 'X000006700003', 1, 0, { STATUS: 'Needed', 'CHECKED BY': 'JV', 'CHECKED DATE': ago(4) }),
      r("Gamma Pant Men's", 'Black', '34', 'X000006700004', 0, 0, { STATUS: 'Needed', 'CHECKED BY': 'JV', 'CHECKED DATE': ago(4) }),
      r("Cerium Hoody Men's", 'Graphite', 'M', 'X000005100001', 1, 0, { STATUS: 'Needed', 'CHECKED BY': 'SC', 'CHECKED DATE': ago(0) }),
      r("Proton Hoody Women's", 'Black', 'XS', 'X000003300001', 1, 0, { STATUS: 'Out of Stock', 'CHECKED BY': 'SC', 'CHECKED DATE': ago(2), '86': ago(2) }),
      r("Squamish Hoody Men's", 'Tatsu', 'L', 'X000002200004', 1, 0, { STATUS: 'Out of Stock', 'CHECKED BY': 'LS', 'CHECKED DATE': ago(1), '86': ago(1) }),
    ];
  })(),
};

const MAO_PASTE = "Cerium Hoody Men's\nSKUX000005100002\nDeptM\nStyleX000005100\nColorGraphite\nSizeL\nUPC686487655518\nAvailable0 / 0\n\nCerium Hoody Men's\nSKUX000005100003\nDeptM\nStyleX000005100\nColorGraphite\nSizeXL\nUPC686487655525\nAvailable0 / 0";
const RECV_PASTE = "ETA:  10-10-2026\nPackage  8069559026403620\nOrigin  9120\nReceipt Type  Package\nFor  Store Inventory\nCarrier  UPS\nPO # 6390185311\nETA:  10-10-2026\nPackage  8069559026403621\nOrigin  9120\nReceipt Type  Package\nFor  Store Inventory\nCarrier  UPS\nPO # 6390185311";

module.exports = { DATA, MAO_PASTE, RECV_PASTE, ago, day };
