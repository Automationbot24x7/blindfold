// Built-in synthetic statements (every person and business in them is made up).
export interface Sample {
  id: 'cafe' | 'hoa' | 'rescue';
  title: string;
  place: string;
  blurb: string;
  context: string; // handed to the models; contains no client names
  period: string;
  approvalRule: boolean; // does this organisation have a sign-off limit for payments?
}

export const SAMPLES: Sample[] = [
  {
    id: 'cafe', title: 'Hollis & Pine Coffee', place: 'Neighborhood café · small business',
    blurb: 'A month of a two-location café’s checking account: card settlements, suppliers, rent, payroll.',
    context: 'a small independent café (business checking account)', period: 'October 2026', approvalRule: false,
  },
  {
    id: 'hoa', title: 'Willow Creek Homeowners Association', place: 'HOA · volunteer treasurer',
    blurb: 'A volunteer treasurer’s quarter: owners’ dues, security, pool, roofing, cash pool passes.',
    context: 'a homeowners’ association run by volunteer board members; payments over the approval limit need board sign-off', period: 'July–September 2026', approvalRule: true,
  },
  {
    id: 'rescue', title: 'Maple Street Animal Rescue', place: 'Small nonprofit · donor-funded',
    blurb: 'A rescue shelter’s operating account: donations, a grant, vet bills, payroll, adoption-day cash.',
    context: 'a small animal-rescue nonprofit; payments over the approval limit need board sign-off', period: 'July–September 2026', approvalRule: true,
  },
];
