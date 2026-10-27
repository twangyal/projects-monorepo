// Everyday words for the topics websites are organised by, so "the stuff about cars" can find "Driving and
// transport". Each group holds words a person might use for the same section of a site. A word may sit in more than
// one group ("visa" is about travel and about immigration).
//
// Words that are also common in unrelated link text are left out on purpose, because a related word may activate a
// control: "learn" (Learn more), "show" (Show more), "work" (How it works), "pay" (Pay now), "policy" (Privacy
// policy), "home", "return" and "top" (Back to top), "news" (read as "new"), "plan", "tickets", "power" and "it".
const GROUPS = [
  ['car', 'cars', 'vehicle', 'vehicles', 'driving', 'driver', 'drivers', 'motoring', 'motorist', 'motorists', 'motor', 'motorbike', 'motorcycle', 'motorcycles', 'road', 'roads', 'traffic', 'parking', 'licence', 'license', 'mot', 'transport'],
  ['transport', 'bus', 'buses', 'train', 'trains', 'rail', 'railway', 'railways', 'tram', 'trams', 'metro', 'subway', 'commute', 'commuting', 'travel'],
  ['travel', 'travelling', 'traveling', 'trip', 'trips', 'holiday', 'holidays', 'vacation', 'vacations', 'abroad', 'overseas', 'flight', 'flights', 'passport', 'passports', 'visa', 'visas', 'tourism', 'tourist', 'tourists', 'destination', 'destinations'],
  ['immigration', 'immigrant', 'immigrants', 'visa', 'visas', 'citizenship', 'citizen', 'citizens', 'nationality', 'asylum', 'residency', 'migrant', 'migrants', 'migration'],
  ['money', 'finance', 'finances', 'financial', 'bank', 'banks', 'banking', 'bill', 'bills', 'billing', 'invoice', 'invoices', 'budget', 'budgeting', 'savings', 'loan', 'loans', 'debt', 'debts', 'mortgage', 'mortgages'],
  ['tax', 'taxes', 'taxation', 'vat', 'duty', 'duties', 'customs'],
  ['benefit', 'benefits', 'allowance', 'allowances', 'welfare', 'entitlement', 'entitlements'],
  ['job', 'jobs', 'employment', 'employer', 'employers', 'employee', 'employees', 'employing', 'career', 'careers', 'vacancy', 'vacancies', 'hiring', 'recruitment', 'recruiting', 'apprenticeship', 'apprenticeships', 'internship', 'internships'],
  ['retirement', 'retire', 'retired', 'retiring', 'pension', 'pensions', 'pensioner', 'pensioners', 'elderly'],
  ['health', 'healthcare', 'medical', 'medicine', 'medicines', 'doctor', 'doctors', 'gp', 'hospital', 'hospitals', 'nhs', 'illness', 'illnesses', 'disease', 'diseases', 'symptoms', 'treatment', 'treatments', 'wellbeing', 'dentist', 'dentists', 'pharmacy', 'nurse', 'nurses'],
  ['disability', 'disabilities', 'disabled', 'accessibility', 'carer', 'carers', 'impairment', 'impairments'],
  ['education', 'school', 'schools', 'learning', 'course', 'courses', 'university', 'universities', 'college', 'colleges', 'student', 'students', 'study', 'studying', 'studies', 'training', 'teacher', 'teachers', 'teaching', 'exam', 'exams', 'qualification', 'qualifications', 'tuition'],
  ['family', 'families', 'child', 'children', 'kids', 'kid', 'childcare', 'parenting', 'parent', 'parents', 'baby', 'babies', 'adoption', 'fostering', 'pregnancy', 'maternity', 'paternity'],
  ['birth', 'births', 'death', 'deaths', 'marriage', 'marriages', 'wedding', 'weddings', 'funeral', 'funerals', 'bereavement'],
  ['housing', 'house', 'houses', 'rent', 'renting', 'rental', 'rentals', 'tenant', 'tenants', 'landlord', 'landlords', 'property', 'properties', 'mortgage', 'mortgages', 'homeless', 'homelessness', 'apartment', 'apartments'],
  ['law', 'laws', 'legal', 'court', 'courts', 'crime', 'crimes', 'police', 'justice', 'lawyer', 'lawyers', 'solicitor', 'solicitors', 'prison', 'prisons'],
  ['environment', 'environmental', 'climate', 'recycling', 'recycle', 'waste', 'rubbish', 'pollution', 'countryside', 'wildlife', 'nature', 'conservation'],
  ['energy', 'electricity', 'gas', 'heating', 'utilities', 'utility'],
  ['business', 'businesses', 'company', 'companies', 'enterprise', 'enterprises', 'startup', 'startups', 'entrepreneur', 'entrepreneurs', 'trading', 'employing'],
  ['food', 'foods', 'recipe', 'recipes', 'cooking', 'cook', 'meal', 'meals', 'dinner', 'lunch', 'breakfast', 'baking', 'eating', 'restaurant', 'restaurants', 'dining', 'cuisine', 'groceries', 'grocery'],
  ['sport', 'sports', 'football', 'soccer', 'basketball', 'tennis', 'cricket', 'rugby', 'golf', 'athletics', 'fitness', 'exercise', 'gym', 'workout', 'workouts'],
  ['film', 'films', 'movie', 'movies', 'cinema', 'tv', 'television', 'streaming'],
  ['music', 'song', 'songs', 'album', 'albums', 'band', 'bands', 'concert', 'concerts', 'playlist', 'playlists', 'radio'],
  ['game', 'games', 'gaming', 'console', 'consoles', 'esports'],
  ['technology', 'tech', 'computer', 'computers', 'computing', 'software', 'hardware', 'digital', 'gadget', 'gadgets', 'electronics'],
  ['phone', 'phones', 'mobile', 'mobiles', 'smartphone', 'smartphones', 'electronics'],
  ['broadband', 'internet', 'wifi', 'network', 'networks'],
  ['clothes', 'clothing', 'fashion', 'apparel', 'outfit', 'outfits', 'dress', 'dresses', 'garment', 'garments', 'menswear', 'womenswear'],
  ['shoe', 'shoes', 'footwear', 'trainers', 'sneakers', 'boots', 'sandals'],
  ['beauty', 'cosmetics', 'makeup', 'skincare', 'fragrance', 'fragrances', 'perfume', 'perfumes', 'haircare'],
  ['furniture', 'homeware', 'homewares', 'decor', 'kitchen', 'kitchenware', 'bedding', 'appliances'],
  ['garden', 'gardens', 'gardening', 'plants', 'outdoor', 'outdoors', 'lawn', 'flowers'],
  ['pet', 'pets', 'dog', 'dogs', 'cat', 'cats', 'animal', 'animals', 'puppy', 'puppies', 'kitten', 'kittens', 'vet', 'vets'],
  ['toy', 'toys', 'kids'],
  ['book', 'books', 'reading', 'novel', 'novels', 'fiction', 'literature', 'ebook', 'ebooks', 'audiobook', 'audiobooks'],
  ['weather', 'forecast', 'forecasts', 'rain', 'temperature', 'temperatures', 'storm', 'storms'],
  ['science', 'sciences', 'scientific', 'research', 'physics', 'chemistry', 'biology', 'astronomy'],
  ['politics', 'political', 'government', 'election', 'elections', 'vote', 'voting', 'parliament', 'democracy'],
  ['price', 'prices', 'pricing', 'cost', 'costs', 'fee', 'fees', 'tariff', 'tariffs', 'rates'],
  ['delivery', 'deliveries', 'shipping', 'postage', 'dispatch', 'courier', 'couriers'],
  ['volunteer', 'volunteers', 'volunteering', 'charity', 'charities'],
];

// The interpreter's own word form: lower case, a plural "s" dropped from words over three letters.
export const stem = word => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word);

const RELATED = new Map();
for (const group of GROUPS) {
  const words = [...new Set(group.map(stem))];
  for (const word of words) {
    const others = RELATED.get(word) ?? new Set();
    for (const other of words) if (other !== word) others.add(other);
    RELATED.set(word, others);
  }
}

/** Words for the same topics as `word` (in the interpreter's stemmed form); empty when it names no topic. */
export function relatedWords(word) {
  return RELATED.get(stem(word)) ?? new Set();
}
