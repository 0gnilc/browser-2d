const firstNames = [
  'Alaric', 'Ambrose', 'Arden', 'Artemis', 'Ashford', 'Astor', 'Aubrey', 'Audric', 'Augustus', 'Avery',
  'Baxter', 'Benedict', 'Bentley', 'Braden', 'Bradford', 'Brantley', 'Brennan', 'Brinley', 'Bristol', 'Broderick',
  'Caden', 'Callahan', 'Camden', 'Carrington', 'Carson', 'Cassius', 'Cedric', 'Chandler', 'Clifford', 'Coleman',
  'Corbin', 'Cornelius', 'Crosby', 'Cullen', 'Cyrus', 'Dalton', 'Damon', 'Dashiell', 'Dawson', 'Declan',
  'Demetrius', 'Desmond', 'Dexter', 'Donovan', 'Dorian', 'Douglas', 'Draven', 'Dresden', 'Duncan', 'Eamon',
  'Edison', 'Edmund', 'Eldon', 'Elliot', 'Emerson', 'Emmett', 'Ephraim', 'Ernest', 'Everett', 'Ezekiel',
  'Fabian', 'Felix', 'Finnegan', 'Fletcher', 'Floyd', 'Forbes', 'Forrest', 'Franklin', 'Fraser', 'Frederick',
  'Garrison', 'Gavin', 'Geoffrey', 'Gideon', 'Gilbert', 'Grady', 'Graham', 'Grant', 'Grayson', 'Gregory',
  'Griffin', 'Griffith', 'Gunnar', 'Gustav', 'Hadley', 'Hamish', 'Hammond', 'Hanson', 'Harlan', 'Harrison',
  'Hartley', 'Harvey', 'Hayden', 'Hendrix', 'Henrik', 'Holden', 'Horace', 'Howard', 'Hudson', 'Hugo',
  'Ignatius', 'Irving', 'Isaac', 'Isidore', 'Ivan', 'Jasper', 'Jefferson', 'Jerome', 'Joaquin', 'Jocelyn',
  'Jonas', 'Judson', 'Julian', 'Julius', 'Keaton', 'Kendrick', 'Kenneth', 'Kieran', 'Kingston', 'Kirby',
  'Knox', 'Kristopher', 'Lambert', 'Lamont', 'Landon', 'Lawrence', 'Lawson', 'Leander', 'Lennox', 'Leopold',
  'Lester', 'Lincoln', 'Lionel', 'Llewellyn', 'Lowell', 'Lucian', 'Luther', 'Magnus', 'Malcolm', 'Marlon',
  'Marshall', 'Matthias', 'Maurice', 'Maverick', 'Maxfield', 'Maxwell', 'Melvin', 'Merritt', 'Merton', 'Milton',
  'Montgomery', 'Mortimer', 'Morton', 'Neville', 'Newton', 'Nico', 'Nigel', 'Nolan', 'Norman', 'Norris',
  'Norton', 'Oberon', 'Octavius', 'Odell', 'Oleander', 'Orion', 'Orlando', 'Orson', 'Osborn', 'Osmond',
  'Palmer', 'Parker', 'Pascal', 'Patton', 'Paxton', 'Peregrine', 'Perry', 'Phineas', 'Pierce', 'Porter',
  'Preston', 'Quincy', 'Quinton', 'Rafferty', 'Ramsey', 'Randolph', 'Reginald', 'Remington', 'Reuben', 'Rhys',
  'Ridley', 'Rigby', 'Roderick', 'Roland', 'Roscoe', 'Rowan', 'Rupert', 'Rutherford', 'Sawyer', 'Seamus',
  'Sebastian', 'Selwyn', 'Septimus', 'Silas', 'Silvester', 'Sinclair', 'Soren', 'Spencer', 'Stanford', 'Sterling',
  'Sullivan', 'Sutton', 'Sylvester', 'Thaddeus', 'Thatcher', 'Theodore', 'Thornton', 'Thurston', 'Tillman', 'Tobias',
  'Tobin', 'Trenton', 'Tristan', 'Ulric', 'Ulysses', 'Upton', 'Uriah', 'Valentin', 'Vaughn', 'Vernon',
  'Victor', 'Vincent', 'Virgil', 'Walden', 'Wallace', 'Walter', 'Warren', 'Warwick', 'Watson', 'Waylon',
  'Webster', 'Wendell', 'Wesley', 'Weston', 'Wilder', 'Wilfred', 'Willard', 'Winston', 'Woodrow', 'Wyatt',
  'Xavier', 'Yale', 'Yardley', 'Yates', 'Zachariah', 'Zander', 'Zane', 'Zelda', 'Zenith', 'Zephyr',
  // 女性名字
  'Adelaide', 'Adeline', 'Adrienne', 'Agatha', 'Allegra', 'Althea', 'Amara', 'Anais', 'Anastasia', 'Annabel',
  'Arabella', 'Araminta', 'Arcadia', 'Arlene', 'Astrid', 'Athena', 'Audrey', 'Aurora', 'Beatrice', 'Belinda',
  'Bernadette', 'Bethany', 'Bianca', 'Blanche', 'Blythe', 'Briar', 'Bridget', 'Bronwyn', 'Cadence', 'Calista',
  'Camilla', 'Candace', 'Cassandra', 'Cecilia', 'Celeste', 'Celestine', 'Chandra', 'Christabel', 'Clarissa', 'Claudette',
  'Clementine', 'Cleo', 'Constance', 'Cora', 'Cordelia', 'Corinne', 'Cornelia', 'Cosette', 'Cressida', 'Daphne',
  'Delilah', 'Della', 'Demelza', 'Desiree', 'Dinah', 'Dorothea', 'Elodie', 'Eloise', 'Elspeth', 'Ember',
  'Emilia', 'Emmeline', 'Enid', 'Esme', 'Estelle', 'Esther', 'Eulalia', 'Evangeline', 'Evelyn', 'Felicity',
  'Fern', 'Fiona', 'Flora', 'Florence', 'Francesca', 'Freya', 'Genevieve', 'Georgia', 'Georgiana', 'Geraldine',
  'Giselle', 'Glenda', 'Gwendolyn', 'Harriet', 'Hazel', 'Heidi', 'Helena', 'Henrietta', 'Hermione', 'Hester',
  'Honora', 'Imogen', 'Ingrid', 'Iris', 'Irene', 'Isadora', 'Isolde', 'Jacqueline', 'Jemima', 'Jessamine',
  'Josephine', 'Judith', 'Juliet', 'Juniper', 'Justine', 'Katarina', 'Kerensa', 'Lacey', 'Lavinia', 'Leona',
  'Leonora', 'Lettice', 'Lillian', 'Linnea', 'Loretta', 'Louisa', 'Lucinda', 'Lucretia', 'Ludmilla', 'Lydia',
  'Mabel', 'Madeline', 'Magnolia', 'Maisie', 'Marcella', 'Margot', 'Marguerite', 'Marianne', 'Marigold', 'Marlene',
  'Matilda', 'Maude', 'Maxine', 'Melanie', 'Melisande', 'Mercy', 'Millicent', 'Minerva', 'Mirabel', 'Miranda',
  'Moira', 'Muriel', 'Myrtle', 'Nadine', 'Naomi', 'Nerissa', 'Nicolette', 'Nina', 'Noelle', 'Nora',
  'Octavia', 'Odette', 'Olive', 'Olivia', 'Ophelia', 'Ottilie', 'Pandora', 'Patience', 'Penelope', 'Petra',
  'Philippa', 'Phoebe', 'Portia', 'Primrose', 'Priscilla', 'Prudence', 'Ramona', 'Raphaela', 'Raven', 'Regina',
  'Rhiannon', 'Rosalind', 'Rosamund', 'Rosanna', 'Rosemary', 'Rowena', 'Roxanne', 'Sabrina', 'Saffron', 'Sapphira',
  'Saskia', 'Selena', 'Seraphina', 'Serena', 'Sibyl', 'Simone', 'Sophronia', 'Soraya', 'Stella', 'Susannah',
  'Sylvia', 'Tabitha', 'Tallulah', 'Tamsin', 'Tatiana', 'Temperance', 'Thalia', 'Theodora', 'Theresa', 'Thomasina',
  'Tilda', 'Titania', 'Ursala', 'Valentina', 'Valerie', 'Vanessa', 'Venetia', 'Vera', 'Veronica', 'Verity',
  'Victoria', 'Violet', 'Virginia', 'Vivienne', 'Wanda', 'Wendy', 'Willa', 'Willow', 'Winifred', 'Winona',
  'Yasmin', 'Yolanda', 'Yvette', 'Yvonne', 'Zara', 'Zelda', 'Zenobia', 'Zoe', 'Zora', 'Zuleika'
];

const middleNames = [
  'Abbott', 'Abernathy', 'Aldridge', 'Alford', 'Ambrose', 'Anders', 'Archer', 'Ashton', 'Atwood', 'Avery',
  'Baird', 'Bancroft', 'Barlow', 'Barrett', 'Barton', 'Beckett', 'Bedford', 'Bennett', 'Benson', 'Berkeley',
  'Bernard', 'Blackwell', 'Blake', 'Boone', 'Bowman', 'Bradford', 'Bradley', 'Brennan', 'Brewster', 'Briggs',
  'Brock', 'Brooks', 'Bryant', 'Burgess', 'Burke', 'Burton', 'Caldwell', 'Carlisle', 'Carlton', 'Carver',
  'Chambers', 'Chandler', 'Chapman', 'Chester', 'Clayton', 'Clifford', 'Colby', 'Coleman', 'Collier', 'Collins',
  'Conrad', 'Cooper', 'Corbett', 'Crane', 'Crawford', 'Crosby', 'Curtis', 'Dale', 'Dalton', 'Dawson',
  'Delaney', 'Denton', 'Devlin', 'Dexter', 'Dixon', 'Donovan', 'Dudley', 'Duncan', 'Dunham', 'Easton',
  'Elbert', 'Eldridge', 'Elliott', 'Ellis', 'Emerson', 'Emmett', 'Ernest', 'Everett', 'Fairfax', 'Faulkner',
  'Fletcher', 'Forbes', 'Forrest', 'Foster', 'Francis', 'Franklin', 'Fraser', 'Garland', 'Garrett', 'Gibson',
  'Gilbert', 'Gladstone', 'Gordon', 'Graham', 'Granger', 'Grant', 'Graves', 'Grayson', 'Griffin', 'Griffith',
  'Hadley', 'Hale', 'Hamilton', 'Hammond', 'Harley', 'Harper', 'Harris', 'Harrison', 'Hartley', 'Hastings',
  'Hawthorne', 'Hayes', 'Haywood', 'Heath', 'Hendrix', 'Herbert', 'Hewitt', 'Holden', 'Holland', 'Howard',
  'Hudson', 'Hughes', 'Humphrey', 'Hunter', 'Irving', 'Jarvis', 'Jasper', 'Jefferson', 'Jerome', 'Keaton',
  'Kendall', 'Kendrick', 'Kennedy', 'Kent', 'Kerr', 'Kingsley', 'Kingston', 'Kirby', 'Knox', 'Lambert',
  'Langston', 'Lawrence', 'Lawson', 'Leighton', 'Lennox', 'Lewis', 'Lincoln', 'Lockwood', 'Lowell', 'Lyndon',
  'Marshall', 'Maxwell', 'Merrill', 'Merritt', 'Mitchell', 'Monroe', 'Montgomery', 'Morgan', 'Morris', 'Morrison',
  'Morton', 'Nash', 'Newton', 'Noble', 'Nolan', 'Norman', 'Norton', 'Norwood', 'Osborne', 'Palmer',
  'Parker', 'Parrish', 'Patton', 'Paxton', 'Pearce', 'Pembroke', 'Perry', 'Pierce', 'Porter', 'Powell',
  'Prescott', 'Preston', 'Quincy', 'Radcliffe', 'Ramsey', 'Randall', 'Redmond', 'Reed', 'Rhodes', 'Ridley',
  'Rockwell', 'Rodney', 'Roland', 'Ross', 'Rupert', 'Russell', 'Rutherford', 'Sawyer', 'Sinclair', 'Spencer',
  'Stanford', 'Stanley', 'Sterling', 'Stewart', 'Strickland', 'Sullivan', 'Sutton', 'Thatcher', 'Thornton', 'Thurston',
  'Tillman', 'Townsend', 'Travers', 'Trenton', 'Tucker', 'Turner', 'Tyson', 'Underwood', 'Upton', 'Vaughn',
  'Vernon', 'Wade', 'Walden', 'Wallace', 'Walpole', 'Walsh', 'Walter', 'Ward', 'Warren', 'Watson',
  'Webster', 'Wellington', 'Wells', 'Wesley', 'Weston', 'Whitfield', 'Whitney', 'Wilder', 'Wilfred', 'Wilkinson',
  'Willard', 'Winston', 'Woodrow', 'Wright', 'Wyatt', 'Yale', 'Yates', 'York', 'Zane', 'Zimmer'
];

const lastNames = [
  'Abernathy', 'Ackerman', 'Adler', 'Ainsworth', 'Albright', 'Aldridge', 'Alford', 'Allerton', 'Ames', 'Andersson',
  'Appleby', 'Armitage', 'Ashford', 'Ashworth', 'Atkinson', 'Attwood', 'Ayers', 'Babcock', 'Bagley', 'Baldridge',
  'Ballard', 'Bancroft', 'Barlow', 'Barnaby', 'Barrington', 'Barton', 'Bascomb', 'Baylor', 'Beaumont', 'Beckford',
  'Bellamy', 'Belmont', 'Bennington', 'Benson', 'Bentley', 'Berkeley', 'Blackburn', 'Blackwood', 'Blakely', 'Blankenship',
  'Bloodworth', 'Bosworth', 'Bracken', 'Bradbury', 'Braddock', 'Bramwell', 'Branson', 'Brantley', 'Braxton', 'Breckenridge',
  'Brewster', 'Bridgewater', 'Brigham', 'Brinley', 'Brockman', 'Bromley', 'Bronson', 'Brookfield', 'Buckley', 'Buckminster',
  'Burkett', 'Burnham', 'Burnside', 'Caldwell', 'Calhoun', 'Calloway', 'Carmichael', 'Carrington', 'Cassidy', 'Cavanaugh',
  'Chadwick', 'Chalmers', 'Chandler', 'Chatsworth', 'Chevalier', 'Childers', 'Chisholm', 'Clifton', 'Coleridge', 'Collingswood',
  'Colton', 'Compton', 'Conley', 'Copeland', 'Corbett', 'Cornwell', 'Covington', 'Crandall', 'Cranston', 'Creighton',
  'Cromwell', 'Crosby', 'Crossley', 'Crowley', 'Cunningham', 'Dalton', 'Danforth', 'Darlington', 'Davenport', 'Dearborn',
  'Delaney', 'Denison', 'Devereux', 'Devonshire', 'Digby', 'Dillingham', 'Donovan', 'Dorchester', 'Drummond', 'Dunbar',
  'Dunlop', 'Dunstan', 'Eastman', 'Eastwood', 'Eccleston', 'Eckhardt', 'Edgerton', 'Ellington', 'Ellsworth', 'Emerson',
  'Emery', 'Ericson', 'Etheridge', 'Everton', 'Fairchild', 'Fairfax', 'Farnsworth', 'Farrell', 'Faulkner', 'Fenwick',
  'Fielding', 'Finchley', 'Fitzpatrick', 'Fitzroy', 'Flannery', 'Fleming', 'Fletcher', 'Fontaine', 'Forsythe', 'Fowler',
  'Foxworth', 'Franklyn', 'Fremont', 'Gallagher', 'Galloway', 'Garrison', 'Gatsby', 'Gilchrist', 'Gillespie', 'Gladstone',
  'Godwin', 'Goodwin', 'Grantham', 'Grayson', 'Greenwood', 'Grenville', 'Grimsby', 'Grover', 'Guthrie', 'Hadley',
  'Haldane', 'Halstead', 'Hammond', 'Hampton', 'Hanover', 'Harcourt', 'Hargrove', 'Harrington', 'Hartley', 'Hastings',
  'Hathaway', 'Haverford', 'Hawkins', 'Hawthorne', 'Hayward', 'Heathcote', 'Hemsworth', 'Henderson', 'Henley', 'Hepburn',
  'Herrington', 'Highmore', 'Hillsborough', 'Hinton', 'Holbrook', 'Hollingsworth', 'Holloway', 'Holmwood', 'Hooper', 'Hopkinson',
  'Hornsby', 'Houghton', 'Huntington', 'Hutchinson', 'Ingram', 'Irvington', 'Iverson', 'Jacobsen', 'Jarrett', 'Jeffries',
  'Jennings', 'Kensington', 'Kershaw', 'Kimbrough', 'Kingsley', 'Kingston', 'Kirkland', 'Kirkpatrick', 'Knightley', 'Knowles',
  'Langford', 'Langley', 'Lansdowne', 'Latham', 'Lathrop', 'Laughton', 'Lawrence', 'Leighton', 'Lennox', 'Levinson',
  'Lexington', 'Lindsey', 'Lockhart', 'Lockwood', 'Lovelace', 'Lovell', 'Lowery', 'Ludlow', 'Lyndon', 'Maddox',
  'Malvern', 'Mansfield', 'Marbury', 'Marlowe', 'Marsden', 'Marshall', 'Martindale', 'Marvell', 'Masterson', 'Mayfield',
  'McAllister', 'McCormick', 'McDonnell', 'McGrath', 'McKenzie', 'Melrose', 'Meriwether', 'Merrick', 'Middleton', 'Milford',
  'Millbrook', 'Milligan', 'Millington', 'Montague', 'Montgomery', 'Moreland', 'Morley', 'Morrison', 'Mortimer', 'Morton',
  'Moseley', 'Mulligan', 'Nettleton', 'Newbury', 'Newkirk', 'Nichols', 'Nicholson', 'Norbury', 'Northcott', 'Northwood',
  'Norton', 'Oakley', 'Ogden', 'Oldham', 'Osborne', 'Overbrook', 'Owens', 'Oxley', 'Paddington', 'Pemberton',
  'Pendleton', 'Pennington', 'Percival', 'Perkins', 'Pettigrew', 'Philips', 'Pickering', 'Pilkington', 'Pitchford', 'Pollard',
  'Prescott', 'Pritchard', 'Quinlan', 'Radcliffe', 'Raleigh', 'Ramsey', 'Randolph', 'Ravenscroft', 'Redmond', 'Remington',
  'Renfrew', 'Ridgeway', 'Rigsby', 'Rockwell', 'Roderick', 'Rothwell', 'Rowland', 'Rutherford', 'Sackville', 'Salisbury',
  'Sanderson', 'Sanford', 'Saunders', 'Sedgwick', 'Selkirk', 'Seymour', 'Shelburne', 'Sheldon', 'Shepherd', 'Sheridan',
  'Sherwood', 'Sinclair', 'Slattery', 'Sloane', 'Somerville', 'Spalding', 'Spaulding', 'Stafford', 'Standish', 'Stanford',
  'Stanwick', 'Stanton', 'Stapleton', 'Steadman', 'Sterling', 'Stockton', 'Stoddard', 'Stokes', 'Stratford', 'Stratton',
  'Strickland', 'Stroud', 'Sullivan', 'Summerfield', 'Sutcliffe', 'Sutherland', 'Swanson', 'Talbot', 'Talmadge', 'Templeton',
  'Thackeray', 'Thatcher', 'Thorburn', 'Thornhill', 'Thornton', 'Thurston', 'Tilden', 'Tindall', 'Tomlinson', 'Townsend',
  'Travers', 'Treadwell', 'Tremaine', 'Trevelyan', 'Trumbull', 'Turnbull', 'Underhill', 'Underwood', 'Upton', 'Valentine',
  'Vanderbrook', 'Vanderbilt', 'Vickers', 'Wakefield', 'Walcott', 'Waldo', 'Wallingford', 'Warburton', 'Wardell', 'Warwick',
  'Washburn', 'Waterford', 'Waverly', 'Weatherby', 'Wellesley', 'Wellington', 'Wentworth', 'Westbrook', 'Westcott', 'Westlake',
  'Weston', 'Wetherby', 'Wharton', 'Whitaker', 'Whitfield', 'Whitmore', 'Wickham', 'Wiggins', 'Wilberforce', 'Willoughby',
  'Winslow', 'Winstead', 'Winterbottom', 'Winthrop', 'Witherspoon', 'Woodbridge', 'Woodbury', 'Woodford', 'Worthington', 'Wycliffe',
  'Wyckoff', 'Wyndham', 'Yardley', 'Yarmouth', 'Yates', 'Youngblood', 'Zachary', 'Zeller', 'Zimmerman', 'Zondervan'
];

/**
 * 随机生成一个英文姓名
 * @returns {string} 生成的姓名
 */
function randomName() {
  const wordCount = Math.random() > 0.5 ? 2 : 3;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  if (wordCount === 2) {
    return `${firstName} ${lastName}`;
  } else {
    const middleName = middleNames[Math.floor(Math.random() * middleNames.length)];
    return `${firstName} ${middleName} ${lastName}`;
  }
}

module.exports = {
    randomName
};
