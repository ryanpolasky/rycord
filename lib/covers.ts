// synthetic fallback records used when discogs is unavailable.
// covers are generated procedurally so the fallback can ship without third-party artwork.

export type DemoRecord = {
  id: string;
  artist: string;
  title: string;
  year: number;
  label: string;
  // a small palette baked in so the procedural cover + spine look intentional
  palette: { bg: string; ink: string; accent: string };
  genre: string;
  country: string;
  // Optional: same-origin URL pointing at the real album cover image. When
  // present, the jacket front face uses the real artwork; the spine stays
  // procedural (drawn from `palette`) for a consistent shelf aesthetic.
  coverUrl?: string;
};

export const demoRecords: DemoRecord[] = [
  {
    id: "joji-smithereens",
    artist: "Joji",
    title: "Smithereens",
    year: 2022,
    label: "88rising / Warner",
    palette: { bg: "#1a1310", ink: "#ead7b8", accent: "#d2734a" },
    genre: "R&B / Lo-fi",
    country: "US",
  },
  {
    id: "carseat-twin",
    artist: "Car Seat Headrest",
    title: "Twin Fantasy",
    year: 2018,
    label: "Matador",
    palette: { bg: "#0d1421", ink: "#e9efff", accent: "#7fa9d8" },
    genre: "Indie Rock",
    country: "US",
  },
  {
    id: "mac-faces",
    artist: "Mac DeMarco",
    title: "Another One",
    year: 2015,
    label: "Captured Tracks",
    palette: { bg: "#1b2415", ink: "#e6e9d4", accent: "#9bc774" },
    genre: "Indie / Jangle Pop",
    country: "CA",
  },
  {
    id: "fka-twigs-magdalene",
    artist: "FKA Twigs",
    title: "Magdalene",
    year: 2019,
    label: "Young Turks",
    palette: { bg: "#231a18", ink: "#f0e5dc", accent: "#c98770" },
    genre: "Art Pop",
    country: "UK",
  },
  {
    id: "phoebe-punisher",
    artist: "Phoebe Bridgers",
    title: "Punisher",
    year: 2020,
    label: "Dead Oceans",
    palette: { bg: "#10131a", ink: "#dde4f0", accent: "#6c8ab2" },
    genre: "Indie Folk",
    country: "US",
  },
  {
    id: "kanye-mbdtf",
    artist: "Kanye West",
    title: "My Beautiful Dark Twisted Fantasy",
    year: 2010,
    label: "Roc-A-Fella",
    palette: { bg: "#26100c", ink: "#f4d9c9", accent: "#c2422a" },
    genre: "Hip Hop",
    country: "US",
  },
  {
    id: "frank-blonde",
    artist: "Frank Ocean",
    title: "Blonde",
    year: 2016,
    label: "Boys Don't Cry",
    palette: { bg: "#1d1815", ink: "#f3e9da", accent: "#d9aa6b" },
    genre: "Alt R&B",
    country: "US",
  },
  {
    id: "tame-currents",
    artist: "Tame Impala",
    title: "Currents",
    year: 2015,
    label: "Modular / Interscope",
    palette: { bg: "#2a1226", ink: "#f6e3f1", accent: "#e58aae" },
    genre: "Psychedelic Pop",
    country: "AU",
  },
  {
    id: "alvvays-blue",
    artist: "Alvvays",
    title: "Blue Rev",
    year: 2022,
    label: "Polyvinyl",
    palette: { bg: "#0f1922", ink: "#e2eef8", accent: "#7fbcd8" },
    genre: "Dream Pop",
    country: "CA",
  },
  {
    id: "khruangbin-mlfn",
    artist: "Khruangbin",
    title: "Mordechai",
    year: 2020,
    label: "Dead Oceans",
    palette: { bg: "#13201c", ink: "#dfeae3", accent: "#74b89b" },
    genre: "Psychedelic Funk",
    country: "US",
  },
  {
    id: "japanese-breakfast-jubilee",
    artist: "Japanese Breakfast",
    title: "Jubilee",
    year: 2021,
    label: "Dead Oceans",
    palette: { bg: "#251a0d", ink: "#f7e6c8", accent: "#f2b347" },
    genre: "Indie Pop",
    country: "US",
  },
  {
    id: "blood-orange-negro-swan",
    artist: "Blood Orange",
    title: "Negro Swan",
    year: 2018,
    label: "Domino",
    palette: { bg: "#1a1822", ink: "#e3e2f1", accent: "#8579bf" },
    genre: "Alt R&B",
    country: "UK",
  },
  {
    id: "weyes-blood-titanic",
    artist: "Weyes Blood",
    title: "Titanic Rising",
    year: 2019,
    label: "Sub Pop",
    palette: { bg: "#0d1d24", ink: "#dde9ec", accent: "#5fa5be" },
    genre: "Chamber Pop",
    country: "US",
  },
  {
    id: "ariel-pink-pomona",
    artist: "Ariel Pink",
    title: "pom pom",
    year: 2014,
    label: "4AD",
    palette: { bg: "#241015", ink: "#f3d4dd", accent: "#d56a89" },
    genre: "Hypnagogic Pop",
    country: "US",
  },
  {
    id: "beach-house-7",
    artist: "Beach House",
    title: "7",
    year: 2018,
    label: "Sub Pop",
    palette: { bg: "#181621", ink: "#dcd9eb", accent: "#7e7bb3" },
    genre: "Dream Pop",
    country: "US",
  },
];
