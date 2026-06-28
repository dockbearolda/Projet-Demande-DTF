export interface Candidate {
  id: string;
  name: string;
  author: string | null;
  description: string;
  category: string;
  installs: number;
  rating2024: number; // the DebugBear 2024 rating snapshot
  ratingNow: number | null; // filled at enrich time from the live CWS page
  ratings: number;
  monthsSinceUpdate: number | null; // enrich (from "Updated" date)
  manifestVersion: number | null; // enrich (from the public CRX)
  lastUpdated: string | null; // enrich (ISO date string)
  keyword: string | null; // the normalized query used for demand
  keywordDemand: number; // [0,1], demand stage
  recentReviews90d: number; // enrich
  fixableComplaints: number; // enrich: recent 1-2★ "broken/abandoned/update" reviews
  reviewsJson: string | null; // enrich: cached recent reviews for the roadmap
  score: number | null;
  reason: string | null; // 'candidate' | 'melting-ice' | 'banned-risk'
  demandAt: string | null;
  enrichedAt: string | null;
}

export interface Review {
  stars: number;
  text: string;
  date: string | null; // raw label as shown ("3 months ago" / "Mar 5, 2024")
  ageMonths: number | null;
}
