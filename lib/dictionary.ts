import type { DictionaryCategory, DictionaryWord, KnowledgeEntry } from "./types";
import { tokenize } from "./rag";
import { withoutModifierWords } from "./question-terms";
import { EXPANDED_LESSONS } from "./knowledge-expansion";

export interface DictionarySeed {
  word: string;
  definition: string;
  partOfSpeech: DictionaryCategory;
  example: string;
  related?: string[];
}

/** DavidAI's initial vocabulary. These are real words persisted to localStorage on first run. */
export const SEED_WORDS: DictionarySeed[] = [
  { word: "Hello", definition: "A word used as a friendly greeting when meeting someone.", partOfSpeech: "noun", example: "Hello! How can I help you today?", related: ["Hi", "Hey", "Greeting"] },
  { word: "World", definition: "The earth and all the people, places and things on it.", partOfSpeech: "noun", example: "The world is full of interesting places.", related: ["Earth", "Planet", "Country"] },
  { word: "I", definition: "A pronoun used by a speaker to refer to themselves.", partOfSpeech: "pronoun", example: "I learn English every day.", related: ["Me", "My", "We"] },
  { word: "You", definition: "A pronoun used to refer to the person being addressed.", partOfSpeech: "pronoun", example: "You are a careful reader.", related: ["Your", "Yours", "We"] },
  { word: "Am", definition: "The first person singular form of the verb to be.", partOfSpeech: "verb", example: "I am ready to learn.", related: ["Is", "Are", "Be"] },
  { word: "Is", definition: "The third person singular form of the verb to be.", partOfSpeech: "verb", example: "The sky is blue.", related: ["Am", "Are", "Be"] },
  { word: "Are", definition: "The plural form of the verb to be.", partOfSpeech: "verb", example: "You are my friend.", related: ["Am", "Is", "Be"] },
  { word: "The", definition: "A definite article used before a particular noun.", partOfSpeech: "article", example: "The book is on the table.", related: ["A", "An", "This"] },
  { word: "Have", definition: "A verb used to show possession or experience.", partOfSpeech: "verb", example: "I have a question about English.", related: ["Has", "Had", "Own"] },
  { word: "Learn", definition: "To gain knowledge or a skill by study, practice or experience.", partOfSpeech: "verb", example: "I learn English every day.", related: ["Study", "Practice", "Understand"] },
  { word: "Plus", definition: "The operation of adding one number to another, shown by the plus sign +.", partOfSpeech: "noun", example: "Five plus three equals eight.", related: ["Addition", "Add", "Minus"] },
  { word: "Minus", definition: "The operation of subtracting one number from another, shown by the minus sign -.", partOfSpeech: "noun", example: "Nine minus four equals five.", related: ["Subtraction", "Subtract", "Plus"] },
  { word: "Multiplied by", definition: "A phrase that means one number is multiplied by another number.", partOfSpeech: "other", example: "Six multiplied by seven equals forty two.", related: ["Multiplication", "Times", "Divide"] },
  { word: "Divided by", definition: "A phrase that means one number is split into equal parts by another number.", partOfSpeech: "other", example: "Twenty divided by four equals five.", related: ["Division", "Quotient", "Multiply"] },
  { word: "Addition", definition: "The operation of combining numbers to find their total sum.", partOfSpeech: "noun", example: "Addition uses the plus sign.", related: ["Plus", "Add", "Sum"] },
  { word: "Subtraction", definition: "The operation of taking one number away from another to find the difference.", partOfSpeech: "noun", example: "Subtraction uses the minus sign.", related: ["Minus", "Subtract", "Difference"] },
  { word: "Multiplication", definition: "The operation of repeated addition that finds a product.", partOfSpeech: "noun", example: "Multiplication can be written with the times sign.", related: ["Times", "Multiply", "Product"] },
  { word: "Division", definition: "The operation of splitting a number into equal parts to find a quotient.", partOfSpeech: "noun", example: "Division can be written with the slash sign.", related: ["Divide", "Quotient", "Fraction"] },
  { word: "Add", definition: "To combine numbers or amounts so that they form a total.", partOfSpeech: "verb", example: "Add five and three to get eight.", related: ["Plus", "Addition", "Sum"] },
  { word: "Subtract", definition: "To take one number or amount away from another to find the difference.", partOfSpeech: "verb", example: "Subtract four from nine to get five.", related: ["Minus", "Subtraction", "Difference"] },
  { word: "Multiply", definition: "To add a number to itself a given number of times.", partOfSpeech: "verb", example: "Multiply six by seven to get forty two.", related: ["Times", "Multiplication", "Product"] },
  { word: "Divide", definition: "To split a number into equal parts or groups.", partOfSpeech: "verb", example: "Divide twenty by four to get five.", related: ["Divided by", "Division", "Quotient"] },
  { word: "Equals", definition: "A word that says two amounts or expressions have the same value.", partOfSpeech: "verb", example: "Five plus three equals eight.", related: ["Equal", "Sum", "Result"] },
  { word: "Times", definition: "A word used to say how many times one number is multiplied by another.", partOfSpeech: "other", example: "Six times seven equals forty two.", related: ["Multiplication", "Multiplied by", "Product"] },
  { word: "Sum", definition: "The result when numbers are added together.", partOfSpeech: "noun", example: "The sum of five and three is eight.", related: ["Addition", "Plus", "Total"] },
  { word: "Difference", definition: "The result when one number is subtracted from another.", partOfSpeech: "noun", example: "The difference between nine and four is five.", related: ["Subtraction", "Minus", "Subtract"] },
  { word: "Product", definition: "The result when numbers are multiplied together.", partOfSpeech: "noun", example: "The product of six and seven is forty two.", related: ["Multiplication", "Times", "Multiply"] },
  { word: "Quotient", definition: "The result when one number is divided by another.", partOfSpeech: "noun", example: "The quotient of twenty divided by four is five.", related: ["Division", "Divided by", "Divide"] },

  { word: "JavaScript", definition: "A programming language used to add interactive behaviour to web pages and to build applications.", partOfSpeech: "noun", example: "JavaScript can change the text on a web page when you click a button.", related: ["Python", "Programming", "Browser"] },
  { word: "Python", definition: "A programming language known for its simple readable syntax and wide use in data work and automation.", partOfSpeech: "noun", example: "Python uses indentation to show the structure of a program.", related: ["JavaScript", "Programming", "Script"] },
  { word: "Variable", definition: "A named place in a program that stores a value which can change while the program runs.", partOfSpeech: "noun", example: "A variable named age can store the number ten.", related: ["Constant", "Value", "Assign"] },
  { word: "Constant", definition: "A named value in a program that does not change after it is set.", partOfSpeech: "noun", example: "In JavaScript, const declares a constant.", related: ["Variable", "Value", "Const"] },
  { word: "Function", definition: "A named block of code that performs a task and can be used again and again.", partOfSpeech: "noun", example: "A function can add two numbers and return the result.", related: ["Method", "Parameter", "Return"] },
  { word: "Parameter", definition: "A value passed into a function so the function can use it when it runs.", partOfSpeech: "noun", example: "The function takes a name as a parameter.", related: ["Function", "Argument", "Return"] },
  { word: "Return", definition: "To send a result from a function back to the part of the program that called it.", partOfSpeech: "verb", example: "The function returns the sum of two numbers.", related: ["Function", "Result", "Value"] },
  { word: "Loop", definition: "A piece of code that repeats its instructions until a condition says to stop.", partOfSpeech: "noun", example: "A loop can print the numbers from one to ten.", related: ["For loop", "While loop", "Repeat"] },
  { word: "Array", definition: "An ordered list of values stored together so a program can work with them.", partOfSpeech: "noun", example: "An array can hold the colours red, green and blue.", related: ["List", "Element", "Index"] },
  { word: "String", definition: "A sequence of characters used in a program to represent text.", partOfSpeech: "noun", example: "The word hello inside quotes is a string.", related: ["Text", "Character", "Value"] },
  { word: "Boolean", definition: "A data type that has one of two values, true or false.", partOfSpeech: "noun", example: "The comparison five is greater than three gives a boolean result.", related: ["True", "False", "Condition"] },
  { word: "Integer", definition: "A whole number data type with no fractional part.", partOfSpeech: "noun", example: "The numbers five and minus three are integers.", related: ["Number", "Float", "Data type"] },
  { word: "Condition", definition: "An expression that is either true or false and controls which code runs.", partOfSpeech: "noun", example: "If the condition is true, the program prints a message.", related: ["Boolean", "If statement", "Conditional"] },
  { word: "Class", definition: "A blueprint in object oriented programming that defines the properties and methods of its objects.", partOfSpeech: "noun", example: "A class named Dog can create objects for different dogs.", related: ["Object", "Method", "Instance"] },
  { word: "Object", definition: "A collection of related values and behaviours that a program can use as one thing.", partOfSpeech: "noun", example: "An object can store a person's name and age together.", related: ["Class", "Property", "Method"] },
  { word: "Method", definition: "A function that belongs to an object or a class.", partOfSpeech: "noun", example: "The method upper changes a Python string to capital letters.", related: ["Function", "Object", "Class"] },
  { word: "Comment", definition: "Text in source code that the computer ignores and that explains the code to people.", partOfSpeech: "noun", example: "In Python, a hash symbol starts a comment.", related: ["Syntax", "Documentation", "Code"] },
  { word: "Syntax", definition: "The set of rules that says how instructions must be written in a programming language.", partOfSpeech: "noun", example: "Python uses indentation as part of its syntax.", related: ["Grammar", "Code", "Error"] },
  { word: "Bug", definition: "A mistake in a program that makes it behave in a way the programmer did not intend.", partOfSpeech: "noun", example: "A bug caused the wrong number to be printed.", related: ["Debug", "Error", "Fix"] },
  { word: "Debug", definition: "To find and remove mistakes from a program so it works correctly.", partOfSpeech: "verb", example: "The programmer debugs the code by printing values.", related: ["Bug", "Error", "Test"] },
  { word: "Compiler", definition: "A tool that translates a whole program into lower level code before it runs.", partOfSpeech: "noun", example: "A compiler turns source code into machine instructions.", related: ["Interpreter", "Translate", "Code"] },
  { word: "Interpreter", definition: "A tool that carries out a program's instructions step by step without first compiling the whole program.", partOfSpeech: "noun", example: "Python usually runs through an interpreter.", related: ["Compiler", "Execute", "Code"] },
  { word: "Library", definition: "A collection of reusable code that a program can call to perform common tasks.", partOfSpeech: "noun", example: "A math library can provide square root and random numbers.", related: ["Module", "Import", "Package"] },
  { word: "Module", definition: "A file of code that can be imported and reused by other programs.", partOfSpeech: "noun", example: "Python programs import modules to use extra functions.", related: ["Library", "Import", "Export"] },
  { word: "Import", definition: "To bring code from another module or library into the program you are writing.", partOfSpeech: "verb", example: "Python uses the import statement to load a module.", related: ["Export", "Module", "Library"] },
  { word: "Export", definition: "To make code from one module available so other programs can use it.", partOfSpeech: "verb", example: "JavaScript uses export to share a function between files.", related: ["Import", "Module", "Share"] },
  { word: "Operator", definition: "A symbol or word that tells a program to perform an operation on values.", partOfSpeech: "noun", example: "The plus operator adds two numbers.", related: ["Plus", "Equals", "Expression"] },
  { word: "Algorithm", definition: "A finite set of clear steps for solving a problem or completing a task.", partOfSpeech: "noun", example: "A sorting algorithm puts a list of numbers in order.", related: ["Step", "Solve", "Program"] },
  { word: "Print", definition: "To display text or a value from a program on the screen.", partOfSpeech: "verb", example: "Python uses print to show a message.", related: ["Output", "Console", "Display"] },
  { word: "Console", definition: "A tool in a browser or terminal that shows a program's output and error messages.", partOfSpeech: "noun", example: "JavaScript can write a message to the browser console.", related: ["Print", "Output", "Debug"] },
  { word: "Data type", definition: "The kind of value a variable can hold, such as a number, string or boolean.", partOfSpeech: "noun", example: "A string and an integer are two different data types.", related: ["String", "Boolean", "Integer"] },
  { word: "If statement", definition: "Code that runs a block only when its condition is true.", partOfSpeech: "noun", example: "An if statement can check whether a number is positive.", related: ["Condition", "Else", "Boolean"] },
  { word: "For loop", definition: "A loop that repeats a block a known number of times or once for each item in a collection.", partOfSpeech: "noun", example: "A for loop can visit every item in an array.", related: ["Loop", "While loop", "Iterate"] },
  { word: "While loop", definition: "A loop that repeats a block as long as its condition stays true.", partOfSpeech: "noun", example: "A while loop can count down from ten to one.", related: ["Loop", "For loop", "Condition"] },

  { word: "Game", definition: "A system with rules and goals where players take actions and try to win.", partOfSpeech: "noun", example: "A game can be played on a computer or in a browser.", related: ["Player", "Score", "Level"] },
  { word: "Sprite", definition: "A two dimensional image used for a character or object in a game.", partOfSpeech: "noun", example: "The player sprite moves across the screen.", related: ["Game", "Animation", "Character"] },
  { word: "Collision", definition: "An event in a game when two objects touch or overlap each other.", partOfSpeech: "noun", example: "A collision between the player and an enemy can reduce health.", related: ["Hitbox", "Game", "Detect"] },
  { word: "Score", definition: "The number of points a player has earned in a game.", partOfSpeech: "noun", example: "The score increases when the player collects a coin.", related: ["Game", "Point", "Win"] },
  { word: "Level", definition: "A stage or section of a game with its own challenge and goals.", partOfSpeech: "noun", example: "The player reaches the next level after finishing the first one.", related: ["Game", "Stage", "Challenge"] },
  { word: "Player", definition: "The character or person taking part in a game.", partOfSpeech: "noun", example: "The player moves left and right with the arrow keys.", related: ["Game", "Character", "Input"] },
  { word: "Enemy", definition: "A character or obstacle in a game that the player must avoid or defeat.", partOfSpeech: "noun", example: "The enemy follows the player across the screen.", related: ["Game", "Player", "Collision"] },
  { word: "Animation", definition: "A sequence of images shown quickly to create the idea of movement.", partOfSpeech: "noun", example: "The animation shows the character running.", related: ["Frame", "Sprite", "Movement"] },
  { word: "Physics", definition: "Rules in a game that control motion, gravity, speed and collisions.", partOfSpeech: "noun", example: "Game physics makes the ball fall to the ground.", related: ["Game", "Gravity", "Collision"] },
  { word: "Game loop", definition: "The repeating cycle in a game that runs once per frame to read input, update state and draw the screen.", partOfSpeech: "noun", example: "The game loop runs once per frame.", related: ["Game", "Frame", "Update"] },
  { word: "Input", definition: "Signals from a keyboard, mouse or touchscreen that a program reads.", partOfSpeech: "noun", example: "The game reads input from the arrow keys.", related: ["Event", "Player", "Keyboard"] },
  { word: "Hitbox", definition: "An invisible area used to detect collisions between objects in a game.", partOfSpeech: "noun", example: "The hitbox around the sprite is larger than the image.", related: ["Collision", "Game", "Detect"] },
  { word: "Coordinate", definition: "A pair of numbers that gives a position on a grid or screen.", partOfSpeech: "noun", example: "The coordinate x ten y twenty places the sprite on screen.", related: ["Position", "Grid", "Screen"] },
  { word: "Frame", definition: "One still image in a sequence that together makes an animation.", partOfSpeech: "noun", example: "The game draws sixty frames every second.", related: ["Animation", "Game loop", "Rate"] },
  { word: "Restart", definition: "To begin a game or program again from the start.", partOfSpeech: "verb", example: "The player can restart the game after losing.", related: ["Game", "Begin", "Reset"] },

  { word: "HTML", definition: "The markup language that gives a web page its structure using elements and tags.", partOfSpeech: "noun", example: "HTML uses the paragraph tag to mark a paragraph.", related: ["CSS", "JavaScript", "Element"] },
  { word: "CSS", definition: "The stylesheet language that controls the colours, fonts and layout of a web page.", partOfSpeech: "noun", example: "CSS can change the background colour of a button.", related: ["HTML", "Style", "Layout"] },
  { word: "DOM", definition: "The document object model that lets JavaScript read and change web page elements.", partOfSpeech: "noun", example: "JavaScript uses the DOM to change a paragraph.", related: ["Element", "JavaScript", "Browser"] },
  { word: "Element", definition: "A single part of a web page such as a paragraph, image or button.", partOfSpeech: "noun", example: "The button is an element on the page.", related: ["HTML", "DOM", "Tag"] },
  { word: "Tag", definition: "A marker in HTML that defines the start and end of an element.", partOfSpeech: "noun", example: "The paragraph tag wraps a block of text.", related: ["HTML", "Element", "Attribute"] },
  { word: "Attribute", definition: "Extra information added to an HTML tag, such as a class or an id.", partOfSpeech: "noun", example: "The class attribute helps CSS find an element.", related: ["HTML", "Tag", "Selector"] },
  { word: "Selector", definition: "A pattern in CSS that chooses which elements to style.", partOfSpeech: "noun", example: "A class selector styles every element with that class.", related: ["CSS", "Element", "Style"] },
  { word: "Style", definition: "The visual rules such as colour, size and spacing applied to a web page.", partOfSpeech: "noun", example: "CSS controls the style of the heading.", related: ["CSS", "Layout", "Selector"] },
  { word: "Layout", definition: "The arrangement of elements on a web page.", partOfSpeech: "noun", example: "A flex layout can place items in a row.", related: ["CSS", "Element", "Responsive"] },
  { word: "Responsive", definition: "A design that adapts to different screen sizes such as phones and desktops.", partOfSpeech: "adjective", example: "A responsive layout changes when the screen is narrow.", related: ["Layout", "CSS", "Screen"] },
  { word: "Event", definition: "An action such as a click or key press that a program can respond to.", partOfSpeech: "noun", example: "A click event runs a function when the button is pressed.", related: ["Listener", "Input", "JavaScript"] },
  { word: "Listener", definition: "A function that waits for an event and runs when the event happens.", partOfSpeech: "noun", example: "An event listener responds to a button click.", related: ["Event", "Function", "JavaScript"] },
  { word: "Form", definition: "A group of inputs on a web page that a user fills in and submits.", partOfSpeech: "noun", example: "The form has fields for a name and email address.", related: ["Input", "Submit", "Website"] },
  { word: "Fetch", definition: "A JavaScript function that requests data from a server over the web.", partOfSpeech: "verb", example: "JavaScript can fetch data from an API and display it.", related: ["API", "Request", "Server"] },
  { word: "API", definition: "An interface that lets one program communicate with another through defined requests.", partOfSpeech: "noun", example: "A web API can return weather data as JSON.", related: ["Fetch", "JSON", "Request"] },
  { word: "JSON", definition: "A text format for exchanging structured data with keys and values.", partOfSpeech: "noun", example: "The API returns a JSON object with a name and age.", related: ["API", "Data", "Object"] },
  { word: "Route", definition: "A URL path that maps to a particular page or action in a web application.", partOfSpeech: "noun", example: "The route slash about shows the about page.", related: ["Website", "URL", "Page"] },
  { word: "Component", definition: "A reusable piece of a web interface that groups its own structure and behaviour.", partOfSpeech: "noun", example: "A button component can be used on many pages.", related: ["Website", "Reusable", "Element"] },
  { word: "Browser", definition: "A program that displays web pages and runs their HTML, CSS and JavaScript.", partOfSpeech: "noun", example: "The browser loads the page and shows the text.", related: ["Website", "HTML", "DOM"] },
  { word: "Server", definition: "A computer that delivers web pages and data to browsers over a network.", partOfSpeech: "noun", example: "The server sends the page when the browser requests it.", related: ["Browser", "API", "Request"] },
];

export interface GrammarSeed {
  id: string;
  title: string;
  content: string;
}

export const GRAMMAR_LESSONS: GrammarSeed[] = [
  { id: "grammar-overview", title: "Grammar: Basic English sentence structure", content: "English sentences use word order to show meaning. The basic parts are subject, verb and object. A subject is who or what acts. A verb is the action or state. An object receives the action. Articles such as a, an and the come before nouns. Adjectives describe nouns. Adverbs describe verbs, adjectives or whole sentences. Capitalize the first word of a sentence and use a full stop at the end." },
  { id: "grammar-subject-verb", title: "Grammar: Subject + Verb", content: "Pattern: Subject + Verb. Example: I run. Here I is the subject and run is the verb. This pattern needs no object." },
  { id: "grammar-svo", title: "Grammar: Subject + Verb + Object", content: "Pattern: Subject + Verb + Object. Example: I read books. I is the subject, read is the verb and books is the object that receives the action." },
  { id: "grammar-sva", title: "Grammar: Subject + Verb + Adjective", content: "Pattern: Subject + Verb + Adjective. Example: The sky is blue. The sky is the subject, is is the verb and blue is the adjective describing the sky." },
  { id: "grammar-svao", title: "Grammar: Subject + Verb + Object + Additional information", content: "Pattern: Subject + Verb + Object + Additional information. Example: I learn English every day. I is the subject, learn is the verb, English is the object and every day tells when the action happens." },
  { id: "grammar-nouns", title: "Grammar: Nouns", content: "A noun names a person, place, thing or idea. Examples: world, book, sky, English, friend. Nouns can be the subject or the object of a sentence." },
  { id: "grammar-pronouns", title: "Grammar: Pronouns", content: "A pronoun stands in for a noun. I and we refer to the speaker. You refers to the listener. He, she, it and they refer to others. Example: I learn English. I is a pronoun acting as the subject." },
  { id: "grammar-adjectives", title: "Grammar: Adjectives", content: "An adjective describes a noun. Examples: blue, careful, interesting. Example: The sky is blue. Blue describes the sky." },
  { id: "grammar-adverbs", title: "Grammar: Adverbs", content: "An adverb adds detail to a verb, adjective or sentence. Many adverbs end in ly. Examples: carefully, quickly, every day. Example: I learn English every day. Every day tells when I learn." },
  { id: "grammar-articles", title: "Grammar: Articles", content: "Articles are a, an and the. Use a and an for general things and the for a particular thing. Example: The book is on the table." },
  { id: "grammar-punctuation", title: "Grammar: Punctuation and capitalization", content: "Capitalize the first word of a sentence and proper nouns such as English. Use a full stop for a statement, a question mark for a question and an exclamation mark for strong feeling. Use commas to separate items in a list." },

  { id: "knowledge-earth-solar-system", title: "Knowledge: Earth and the solar system", content: "Earth is the third planet from the Sun and the only known world with life. There are eight planets in the solar system. Earth has one natural satellite, the Moon. The Sun is a star that provides light and heat. Water covers about 71 percent of Earth's surface, and the planet has continents, oceans, mountains, rivers and an atmosphere." },
  { id: "knowledge-moon-tides", title: "Knowledge: Moon and tides", content: "The Moon orbits Earth about once a month. Its gravity pulls on Earth's oceans and helps cause tides. When the Moon and Sun pull together, tides are higher; when their pulls partly cancel, tides are lower. The Moon does not make its own light; it reflects sunlight." },
  { id: "knowledge-seasons", title: "Knowledge: Seasons and Earth's tilt", content: "Seasons happen because Earth's axis is tilted about 23.5 degrees while the planet orbits the Sun. When a hemisphere leans toward the Sun, it receives more direct sunlight and has summer. When it leans away, it has winter. Seasons are not caused mainly by changes in distance from the Sun." },
  { id: "knowledge-stars-galaxies", title: "Knowledge: Stars and galaxies", content: "A star is a huge ball of hot gas that produces energy by nuclear fusion. The Sun is an ordinary star. A galaxy is a large system of stars, gas and dust held together by gravity. Earth is in the Milky Way galaxy. Light from distant stars and galaxies can take many years to reach Earth." },

  { id: "knowledge-matter-states", title: "Knowledge: Matter and its states", content: "Matter is anything that has mass and takes up space. Common states of matter are solid, liquid and gas. A solid keeps its shape, a liquid takes the shape of its container, and a gas spreads to fill available space. Temperature and pressure can change a substance from one state to another, such as ice melting into water or water boiling into steam." },
  { id: "knowledge-energy", title: "Knowledge: Energy and conservation", content: "Energy is the ability to do work or cause change. It can appear as motion, heat, light, sound, electricity, chemical energy or stored position. The law of conservation of energy says energy is not created or destroyed in ordinary processes; it changes from one form to another. Machines and living things convert energy rather than make it from nothing." },
  { id: "knowledge-gravity", title: "Knowledge: Gravity", content: "Gravity is the attraction between objects that have mass. It gives objects weight, keeps people on Earth's surface, and holds planets in orbit around stars. More massive objects pull more strongly, and the pull gets weaker with distance. Gravity is not the same as magnetism, although both can act at a distance." },
  { id: "knowledge-atoms-elements", title: "Knowledge: Atoms and elements", content: "An atom is the basic unit of a chemical element. It has a small nucleus containing protons and usually neutrons, surrounded by electrons. The number of protons determines the element. Elements are arranged in the periodic table by their properties and atomic number. Atoms can bond together to form molecules and compounds." },
  { id: "knowledge-light-sound", title: "Knowledge: Light and sound", content: "Light is electromagnetic radiation that can travel through empty space. Sound is a vibration that needs a material such as air, water or solid matter to travel through. Light travels much faster than sound in air, which is why lightning is seen before its thunder is heard. White light can be split into a spectrum of colours." },

  { id: "knowledge-cells", title: "Knowledge: Cells and life", content: "A cell is the smallest unit that can carry out the processes of life. Some organisms, such as bacteria, have one cell. Plants and animals have many cells that form tissues and organs. Cells take in nutrients, release waste, respond to their surroundings and contain genetic instructions. Plant cells have cell walls and chloroplasts, while animal cells do not." },
  { id: "knowledge-dna", title: "Knowledge: DNA and inheritance", content: "DNA is the molecule that carries genetic instructions in living things. It is found mainly in chromosomes inside cell nuclei. A gene is a section of DNA that influences a trait. Offspring inherit DNA from their parents, which is why related organisms share features. DNA can be copied when cells divide, and changes in it are called mutations." },
  { id: "knowledge-photosynthesis", title: "Knowledge: Photosynthesis", content: "Photosynthesis is the process by which green plants, algae and some bacteria use sunlight to make sugar from carbon dioxide and water. Chlorophyll absorbs light energy. Oxygen is released as a by-product. The sugar stores chemical energy that plants can use for growth, and it forms the basis of many food chains." },
  { id: "knowledge-body-systems", title: "Knowledge: Human body systems", content: "The human body has interacting systems. The circulatory system uses the heart to pump blood and move oxygen and nutrients. The respiratory system uses lungs to take in oxygen and remove carbon dioxide. The digestive system breaks food into nutrients. The nervous system, including the brain and spinal cord, processes information and coordinates responses." },
  { id: "knowledge-health-basics", title: "Knowledge: Health basics", content: "Regular sleep, balanced nutrition, movement, hydration and social connection support health. Preventive care and vaccines can reduce the risk of some diseases. Health needs vary between people, and persistent symptoms should be discussed with a qualified health professional. Avoid sharing private medical details with untrusted systems." },
  { id: "knowledge-ecosystems", title: "Knowledge: Ecosystems and food chains", content: "An ecosystem is a community of living organisms interacting with each other and with their physical environment. Energy usually enters through sunlight captured by plants or other producers. Food chains show energy passing from producers to herbivores, then to predators and decomposers. Nutrients are recycled through soil, water and living things." },

  { id: "knowledge-arithmetic", title: "Knowledge: Arithmetic", content: "Arithmetic is the branch of mathematics concerned with numbers and the operations of addition, subtraction, multiplication and division. Addition combines quantities, subtraction finds a difference, multiplication is repeated addition, and division splits a quantity into equal parts. Calculations follow an order of operations: parentheses, exponents, multiplication and division from left to right, then addition and subtraction from left to right." },
  { id: "knowledge-math-vocabulary", title: "Knowledge: Math vocabulary and symbols", content: "Plus means addition and is written with the plus sign. Five plus three equals eight. Minus means subtraction and is written with the minus sign. Nine minus four equals five. Multiplied by and times mean multiplication. Six multiplied by seven equals forty two. Divided by means division. Twenty divided by four equals five. Addition gives a sum, subtraction gives a difference, multiplication gives a product and division gives a quotient. The result is the answer to a calculation." },
  { id: "knowledge-algebra", title: "Knowledge: Algebra", content: "Algebra uses letters or symbols called variables to stand for unknown values or quantities that can change. An equation states that two expressions are equal. Solving an equation means finding values that make the statement true. Algebra is used to describe patterns, relationships and rules in science, engineering, finance and everyday problem solving." },
  { id: "knowledge-geometry", title: "Knowledge: Geometry", content: "Geometry studies shapes, sizes, angles, positions and space. A triangle has three sides and its interior angles add to 180 degrees. A square has four equal sides and four right angles. The area of a rectangle is length multiplied by width. The circumference of a circle is pi multiplied by its diameter, and its area is pi multiplied by the radius squared." },
  { id: "knowledge-probability-statistics", title: "Knowledge: Probability and statistics", content: "Probability measures how likely an event is, expressed from 0, meaning impossible, to 1, meaning certain. Statistics collects, summarizes and interprets data. The mean is the average, the median is the middle value after ordering, and the mode is the most frequent value. Correlation between two things does not by itself prove that one causes the other." },
  { id: "knowledge-units-measurement", title: "Knowledge: Measurement and units", content: "A measurement needs a number and a unit. The International System of Units uses the metre for length, kilogram for mass, second for time, ampere for electric current, kelvin for temperature, mole for amount of substance and candela for light intensity. Prefixes change scale: kilo means one thousand, centi means one hundredth and milli means one thousandth." },
  { id: "knowledge-time-calendar", title: "Knowledge: Time and calendars", content: "A day is based on Earth's rotation, a month is loosely based on the Moon's cycle, and a year is based on Earth's orbit around the Sun. A week has seven days: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday and Sunday. A common year has 365 days and a leap year has 366 days to keep the calendar aligned with the seasons. Time zones keep local clocks roughly matched to daylight." },

  { id: "knowledge-computers-binary", title: "Knowledge: Computers and binary", content: "Digital computers represent information using binary digits called bits, which have the values 0 or 1. Eight bits make a byte. A processor follows instructions to perform arithmetic, move data and make decisions. Memory stores data being used now, while storage keeps data for later. Computer programs are sequences of instructions that tell hardware what to do." },
  { id: "knowledge-internet", title: "Knowledge: Internet and web", content: "The internet is a global network of networks that uses protocols such as TCP and IP to move data between devices. The World Wide Web is a service on the internet made of pages linked by hyperlinks. Browsers request pages using HTTP or HTTPS and render HTML, CSS and JavaScript. HTTPS adds encryption so data between a browser and a site is protected in transit." },
  { id: "knowledge-algorithms", title: "Knowledge: Algorithms", content: "An algorithm is a finite, ordered set of steps for solving a problem or completing a task. Examples include searching a list, sorting numbers and finding a route. A good algorithm is clear, terminates and produces the expected result for valid inputs. Algorithms differ in how much time and memory they need as the size of the input grows." },
  { id: "knowledge-programming", title: "Knowledge: Programming languages", content: "A programming language is a formal language for writing instructions that a computer can carry out. Python, JavaScript, Java, C and Rust are widely used examples. Languages use variables, expressions, control flow and functions to organize logic. Compilers translate whole programs into lower-level code, while interpreters execute programs step by step." },
  { id: "knowledge-javascript-language", title: "Knowledge: JavaScript programming", content: "JavaScript is a programming language that runs in web browsers and can also run on servers with Node.js. It adds behaviour to web pages, such as responding to clicks, validating forms and updating content. A variable is declared with let, const or var. A function is a reusable block of code that can take parameters and return a value. Arrays hold ordered lists, and objects store named properties. A for loop or a while loop repeats code, and an if statement runs code only when a condition is true. The console displays output and error messages to help debug code." },
  { id: "knowledge-python-language", title: "Knowledge: Python programming", content: "Python is a programming language valued for readable syntax and broad use in data analysis, automation, science and web applications. A variable is created by assigning a value with the equals sign. A function is defined with the def keyword, can take parameters and returns a result with the return statement. A list is an ordered collection, and a dictionary stores values by key. Indentation groups blocks of code in an if statement, a for loop or a while loop. The print function shows output, and a comment begins with a hash symbol." },
  { id: "knowledge-coding-fundamentals", title: "Knowledge: Coding fundamentals", content: "Coding means writing instructions for a computer to follow. A variable is a named place that stores a value, while a constant holds a value that does not change. Every value has a data type, such as a string for text, an integer for a whole number or a boolean for true and false. An operator such as plus or equals performs an operation. A function groups statements into a reusable block that can accept parameters and return a result. Control flow uses an if statement to choose between paths and a loop to repeat work. An algorithm is the clear set of steps that solves the problem." },
  { id: "knowledge-reading-code", title: "Knowledge: Reading and writing code", content: "Reading code means tracing what each statement does in order. In JavaScript, let count = 0 creates a variable, count = count + 1 adds one, and console.log prints the value. In Python, count = 0 creates a variable, count = count + 1 adds one, and print(count) displays the value. Quotes around text create a string. Indentation in Python and braces in JavaScript show which statements belong to a function or a loop. Comments explain the code without running it. Syntax errors stop a program, while logic errors produce a wrong result and are found by debugging and testing." },
  { id: "knowledge-game-development", title: "Knowledge: How to make a game", content: "Game development builds interactive experiences with rules, goals and feedback. A simple two dimensional game has a game loop that runs once per frame, often sixty times each second. Each frame reads input from the keyboard or mouse, updates the state of the player, enemies and score, checks for collisions between sprites using hitboxes, and draws the new positions on the screen. Physics rules control gravity, speed and movement. A collision happens when two hitboxes overlap. The game tracks a score, advances to the next level when goals are met, and shows a win condition or a restart option when the game ends. A sprite is the image for a character, and animation cycles through frames to show movement." },
  { id: "knowledge-game-code-patterns", title: "Knowledge: Game code patterns", content: "In a JavaScript game, requestAnimationFrame drives the game loop. An update function moves the player based on input, applies gravity and velocity, checks collisions by comparing sprite coordinates, and updates the score. A draw function clears the canvas and redraws each sprite at its current coordinate. Animation steps through a list of frames to show running or jumping. When an enemy or obstacle collides with the player, the game can reduce health or end the level. When the score reaches a target, the game shows a win condition. A restart function resets the state and begins a new game. Collision detection compares hitboxes, which are invisible rectangles around sprites." },
  { id: "knowledge-website-development", title: "Knowledge: How to build a website", content: "Building a website uses HTML, CSS and JavaScript together. HTML gives the page structure with elements such as headings, paragraphs, images, forms and buttons. Each element is written with tags and can have attributes such as a class or an id. CSS uses selectors to choose elements and apply styles for colour, font, spacing and layout. A responsive layout adapts to different screen sizes such as phones and desktops. JavaScript uses the DOM to find elements, listens for events such as clicks and key presses, and changes the page when those events happen. A form collects input, and a fetch request can send it to an API. The API often returns JSON data that the page displays. A route maps a URL path to a page, and a component is a reusable piece of the interface." },
  { id: "knowledge-web-code-patterns", title: "Knowledge: Web code patterns", content: "A simple web page starts with an HTML document containing a head and a body, and the body holds the visible elements. CSS rules in a stylesheet use selectors such as a class selector to style elements. JavaScript attaches an event listener to a button, and the listener function runs when a click event happens. To build an interface, a component groups related HTML, CSS and JavaScript so it can be reused. Routes map URL paths to different pages in a web application. A fetch call requests data from a server API, and the response is parsed as JSON before the DOM is updated to show it. The browser loads the HTML, applies the CSS and runs the JavaScript to display the finished page." },
  { id: "knowledge-ai-machine-learning", title: "Knowledge: Artificial intelligence and machine learning", content: "Artificial intelligence is the field of building systems that perform tasks usually associated with human intelligence, such as recognizing patterns, understanding language or making decisions. Machine learning is a branch of AI that improves a model's behaviour by adjusting parameters from training data. A trained model can generate or classify patterns, but training does not give it consciousness, feelings or guaranteed factual accuracy." },
  { id: "knowledge-data-security", title: "Knowledge: Data privacy and security", content: "Data privacy concerns what information is collected, why it is used and who can access it. Data security protects information with measures such as encryption, authentication, access control and backups. Strong unique passwords and two-factor authentication reduce account risk. Privacy settings and data exports help people understand and control what an application stores." },

  { id: "knowledge-critical-thinking", title: "Knowledge: Critical thinking and evidence", content: "Critical thinking means examining claims before accepting them. Useful habits include separating observations from interpretations, checking whether evidence supports a conclusion, considering alternative explanations and noting the limits of a source. A confident tone is not evidence. When information is missing, it is better to ask a precise question or state uncertainty than to invent an answer." },
  { id: "knowledge-estimates-uncertainty", title: "Knowledge: Estimates and uncertainty", content: "An estimate is an approximate answer based on available information. An exact value usually requires a reliable measurement or source. Uncertainty should be stated when data is incomplete, noisy or changing. Ranges, confidence levels and assumptions make estimates more useful. An estimate should not be presented as a verified fact." },
  { id: "knowledge-clarifying-questions", title: "Knowledge: Clarifying questions", content: "A clarifying question helps when a request is ambiguous, uses an undefined term or lacks context. Good clarifying questions are short and target the missing information, such as which meaning, time period, place or goal is intended. Asking for clarification is a valid response when answering accurately would otherwise require guessing." },
  { id: "knowledge-learning-strategies", title: "Knowledge: Learning and memory", content: "Learning is stronger when practice is spaced over time rather than crammed into one session. Retrieval practice, explaining an idea in your own words and testing yourself improve recall. Sleep helps consolidate memory. Mistakes are useful when they are reviewed and corrected, because the correction identifies what should change." },
  { id: "knowledge-cause-effect", title: "Knowledge: Cause and effect", content: "A cause produces or contributes to an effect. To judge causation, check whether the cause came before the effect, whether the two are related, and whether other explanations can be ruled out. Repeated association alone does not prove causation. Experiments and careful observation help separate genuine causes from coincidence." },

  { id: "knowledge-geography", title: "Knowledge: Continents and oceans", content: "The seven continents are Africa, Antarctica, Asia, Australia, Europe, North America and South America. The five oceans are the Pacific, Atlantic, Indian, Southern and Arctic oceans. Asia is the largest continent by area, and the Pacific is the largest ocean. Oceans regulate climate, provide food and contain a wide variety of life." },
  { id: "knowledge-weather-climate", title: "Knowledge: Weather and climate", content: "Weather describes short-term atmospheric conditions such as temperature, rain, wind and cloud cover. Climate is the long-term pattern of weather in a place, usually measured over decades. Weather can change from hour to hour, while climate changes much more slowly. Greenhouse gases affect climate by trapping some heat in Earth's atmosphere." },
  { id: "knowledge-maps-coordinates", title: "Knowledge: Maps and coordinates", content: "A map represents places using scale, symbols and a legend. Latitude lines run east and west and measure distance north or south of the equator. Longitude lines run north and south and measure distance east or west of the prime meridian. A location can be described with a latitude and longitude pair. Map scale relates distances on the map to real distances." },
  { id: "knowledge-money-trade", title: "Knowledge: Money and trade", content: "Money serves as a medium of exchange, a unit of account and a store of value. Trade allows people and countries to specialize in what they produce well and exchange for other goods and services. Prices are influenced by supply, demand, costs and expectations. Inflation means prices rise over time, reducing the purchasing power of a fixed amount of money." },
  { id: "knowledge-rules-laws", title: "Knowledge: Rules and laws", content: "Rules are agreed expectations for behaviour in a group, while laws are rules made and enforced by a government or other authority. Laws differ between places and can change over time. They cover areas such as safety, property, contracts and rights. When legal guidance is needed, a qualified professional in the relevant jurisdiction should be consulted." },

  { id: "knowledge-number-systems", title: "Knowledge: Number systems", content: "Natural numbers are the counting numbers 1, 2, 3 and so on. Whole numbers add zero. Integers include negative whole numbers. A rational number can be written as a fraction of two integers, such as 3/4 or -2/5. An irrational number cannot be written as a simple fraction, such as pi or the square root of 2. Rational and irrational numbers together form the real numbers. Complex numbers include a real part and an imaginary part based on i, where i squared equals -1." },
  { id: "knowledge-fractions", title: "Knowledge: Fractions", content: "A fraction has a numerator above the line and a denominator below it. The denominator tells how many equal parts make a whole. Fractions with the same value are equivalent, for example 1/2 and 2/4. To add or subtract fractions, use a common denominator: 1/2 + 1/3 = 3/6 + 2/6 = 5/6. To multiply fractions, multiply numerators and denominators. To divide, multiply by the reciprocal of the second fraction." },
  { id: "knowledge-decimals-percentages", title: "Knowledge: Decimals and percentages", content: "Decimal places show tenths, hundredths and thousandths. A percentage means a number out of 100. To find a percentage of a quantity, convert the percentage to a decimal and multiply: 25% of 80 is 0.25 times 80, which is 20. Percentage change is the change divided by the original value, multiplied by 100. A 10% increase followed by a 10% decrease does not return to the original value." },
  { id: "knowledge-ratios-proportions", title: "Knowledge: Ratios and proportions", content: "A ratio compares two quantities, such as 2:3. A proportion says two ratios are equal, for example 2:3 = 4:6. Cross multiplication can solve proportions: if a/b = c/d then a times d equals b times c. Ratios are used for scales, maps, recipes and mixing quantities. Direct proportion means both quantities increase together; inverse proportion means one increases while the other decreases." },
  { id: "knowledge-exponents-roots", title: "Knowledge: Exponents and roots", content: "An exponent shows repeated multiplication: 2^3 = 2 times 2 times 2 = 8. Any nonzero number to the power of zero is 1. Negative exponents mean reciprocals, so 2^-2 = 1/4. When multiplying powers with the same base, add exponents; when dividing, subtract exponents. A square root reverses squaring, so the square root of 9 is 3. A cube root reverses cubing, so the cube root of 8 is 2." },
  { id: "knowledge-order-operations", title: "Knowledge: Order of operations", content: "Calculations follow a fixed order: parentheses first, then exponents, then multiplication and division from left to right, then addition and subtraction from left to right. For example, 3 + 4 times 2^2 = 3 + 4 times 4 = 3 + 16 = 19. The same rules are sometimes called PEMDAS or BODMAS. Changing the order changes the result, so brackets should be used when a different order is intended." },
  { id: "knowledge-negative-numbers", title: "Knowledge: Negative numbers", content: "Negative numbers lie to the left of zero on a number line. Adding a positive moves right; adding a negative moves left. Subtracting a negative is the same as adding a positive. Multiplying or dividing two numbers with the same sign gives a positive result, while different signs give a negative result. For example, -3 + 5 = 2 and -4 times -2 = 8." },

  { id: "knowledge-linear-equations", title: "Knowledge: Linear equations", content: "A linear equation has an unknown with power one, such as 3x + 5 = 20. Solving means finding the value that makes the equation true. Do the same operation to both sides to keep the equation balanced. Here, subtract 5 to get 3x = 15, then divide by 3 to get x = 5. Always substitute the answer back into the original equation to check it." },
  { id: "knowledge-inequalities", title: "Knowledge: Inequalities", content: "Inequalities use <, >, <= and >= instead of equality. They can be solved like equations, except that multiplying or dividing by a negative number reverses the inequality sign. For example, -2x > 6 becomes x < -3. Solutions can be shown on a number line with an open circle for strict inequality and a closed circle when equality is included." },
  { id: "knowledge-quadratics", title: "Knowledge: Quadratic equations", content: "A quadratic equation has the form ax^2 + bx + c = 0 with a not equal to zero. It can have two real solutions, one repeated solution or no real solutions. Some quadratics factor easily: x^2 - 5x + 6 = 0 factors as (x - 2)(x - 3) = 0, so x = 2 or x = 3. The quadratic formula, x = (-b plus or minus the square root of b^2 - 4ac) divided by 2a, works for all quadratic equations." },
  { id: "knowledge-functions", title: "Knowledge: Functions", content: "A function assigns exactly one output to each input. It is often written f(x), such as f(x) = 2x + 1, so f(3) = 7. The domain is the set of allowed inputs and the range is the set of possible outputs. A linear function has a constant rate of change and a straight-line graph. A quadratic function has an x squared term and a parabolic graph." },
  { id: "knowledge-coordinate-graphing", title: "Knowledge: Coordinate graphing", content: "The coordinate plane uses a horizontal x axis and a vertical y axis. A point is written as an ordered pair (x, y). The slope of a line is the change in y divided by the change in x. For the points (2, 3) and (4, 7), the slope is (7 - 3) divided by (4 - 2), which is 2. The y intercept is where the line crosses the y axis, and the x intercept is where it crosses the x axis." },

  { id: "knowledge-pythagorean", title: "Knowledge: Pythagorean theorem", content: "In a right triangle, the square of the hypotenuse equals the sum of the squares of the other two sides: a^2 + b^2 = c^2. If the legs are 3 and 4, then c^2 = 9 + 16 = 25, so the hypotenuse is 5. The theorem only applies to right triangles. It is used in construction, navigation, surveying and many coordinate geometry problems." },
  { id: "knowledge-circles", title: "Knowledge: Circles", content: "The radius is the distance from the centre to the edge. The diameter is twice the radius. Circumference is the distance around the circle and equals 2 times pi times the radius. Area equals pi times the radius squared. For a circle with radius 3, the circumference is 6 pi and the area is 9 pi. Pi is approximately 3.14159." },
  { id: "knowledge-area-volume", title: "Knowledge: Area and volume", content: "Area measures the size of a flat surface. A rectangle has area length times width. A triangle has area half of base times height. A parallelogram has area base times height. Volume measures space inside a solid: a rectangular prism has volume length times width times height, and a cylinder has volume pi times radius squared times height. Area uses square units and volume uses cubic units." },
  { id: "knowledge-angle-rules", title: "Knowledge: Angle rules", content: "Complementary angles add to 90 degrees and supplementary angles add to 180 degrees. Angles opposite each other at an intersection are equal. The interior angles of a triangle always add to 180 degrees. When a line crosses parallel lines, corresponding angles are equal and alternate interior angles are equal. These rules help find missing angles in geometric figures." },
  { id: "knowledge-trigonometry", title: "Knowledge: Trigonometry basics", content: "Trigonometry relates angles to side lengths in right triangles. Sine is opposite side divided by hypotenuse, cosine is adjacent side divided by hypotenuse, and tangent is opposite side divided by adjacent side. Common exact values include sin 30 degrees = 1/2, cos 60 degrees = 1/2 and tan 45 degrees = 1. The Pythagorean identity sin^2(x) + cos^2(x) = 1 holds for every angle x." },

  { id: "knowledge-sequences-series", title: "Knowledge: Sequences and series", content: "A sequence is an ordered list of numbers. In an arithmetic sequence, each term adds the same difference, such as 2, 5, 8, 11 with common difference 3. In a geometric sequence, each term multiplies by the same ratio, such as 3, 6, 12, 24 with common ratio 2. A series is the sum of sequence terms. The nth term of an arithmetic sequence is a + (n - 1)d." },
  { id: "knowledge-combinatorics", title: "Knowledge: Combinatorics", content: "Combinatorics counts arrangements and selections. A factorial n! is the product of all positive integers up to n, so 5! = 120. Permutations count arrangements where order matters, while combinations count selections where order does not matter. Choosing 2 items from 4 gives 6 combinations. The counting principle multiplies the number of choices at each independent step." },
  { id: "knowledge-set-theory", title: "Knowledge: Set theory", content: "A set is a collection of distinct objects. The union of two sets contains everything in either set, while the intersection contains only what is in both. The complement contains everything in the universal set that is not in the given set. A subset has all its elements in a larger set. Venn diagrams show these relationships visually." },
  { id: "knowledge-logic-proofs", title: "Knowledge: Logic and proofs", content: "A mathematical proof shows why a statement is always true. A direct proof starts from known facts and reaches the conclusion. A counterexample disproves a statement by giving one case where it fails. The converse of if A then B is if B then A, and it is not automatically true. The contrapositive, if not B then not A, has the same truth value as the original statement." },

  { id: "knowledge-calculus-limits-derivatives", title: "Knowledge: Calculus limits and derivatives", content: "A limit describes the value a function approaches as an input gets close to a point, even if the function is not defined there. A derivative measures an instantaneous rate of change and gives the slope of a tangent line. The power rule says the derivative of x^n is n times x^(n-1), so the derivative of x^2 is 2x. Derivatives are used for velocity, optimisation and curve sketching." },
  { id: "knowledge-calculus-integrals", title: "Knowledge: Calculus integrals", content: "An integral can represent accumulated quantity or the area under a curve. An indefinite integral finds a family of antiderivatives and includes a constant C, so the integral of 2x is x^2 + C. A definite integral gives a number between two bounds. The fundamental theorem of calculus connects differentiation and integration, showing they are inverse processes." },
  { id: "knowledge-statistics-distributions", title: "Knowledge: Statistical distributions", content: "The mean is the sum of values divided by the count, the median is the middle ordered value, and the mode is the most frequent value. The range is the largest value minus the smallest. Variance and standard deviation measure how spread out values are around the mean. A normal distribution is symmetric and bell shaped, with about 68 percent of values within one standard deviation of the mean. Correlation does not prove causation." },
  { id: "knowledge-financial-math", title: "Knowledge: Financial mathematics", content: "Simple interest equals principal times rate times time. Compound interest adds interest to previous interest, so the amount grows faster. For example, 1000 at 5 percent compound interest for two years becomes 1102.50. Percentages are also used for discounts, tax, profit and loss. When comparing deals, calculate the final amount rather than trusting the advertised percentage alone." },
  { id: "knowledge-problem-solving", title: "Knowledge: Mathematical problem solving", content: "A reliable approach is to understand the question, list the known and unknown quantities, choose a strategy, calculate carefully and check whether the answer makes sense. Drawing a diagram or writing an equation often reveals the structure. Estimation can catch large errors before finalising an answer. If a direct method fails, try a simpler case, work backwards or look for a pattern." },

  { id: "knowledge-ancient-civilizations", title: "Knowledge: Ancient civilizations", content: "Early civilizations developed in river valleys where farming could support larger populations. Mesopotamia grew between the Tigris and Euphrates, ancient Egypt along the Nile, the Indus Valley on the Indian subcontinent, and ancient China along the Yellow River. These societies developed writing, law, trade, architecture and organized religion. Their achievements varied by region and time period." },
  { id: "knowledge-world-wars", title: "Knowledge: World wars", content: "World War I began in 1914 and ended in 1918. World War II began in 1939 and ended in 1945. Both conflicts involved many countries and caused enormous military and civilian losses. The wars reshaped borders, governments and international institutions. Historical explanations of their causes remain complex and are studied from political, economic and social perspectives." },
  { id: "knowledge-exploration-trade", title: "Knowledge: Exploration and trade", content: "Long-distance trade connected regions long before modern transport. The Silk Road linked East Asia, Central Asia and the Mediterranean through networks of merchants. Maritime trade later connected Europe, Africa, Asia and the Americas. Exploration expanded maps and exchange, but it also brought colonization, forced labour and disease. The consequences were different for each society involved." },
  { id: "knowledge-art-movements", title: "Knowledge: Art movements", content: "Art movements are groups of artists who share ideas or styles. The Renaissance emphasized perspective, anatomy and classical subjects. Impressionism used loose brushwork and changing light. Cubism broke objects into geometric forms. Abstract art does not aim to represent the visible world directly. Movements overlap, and many artists work in more than one style." },
  { id: "knowledge-music-theory", title: "Knowledge: Music theory basics", content: "Pitch describes how high or low a note sounds. A scale is an ordered set of pitches, and a key centres music around one note. Rhythm organizes sounds in time through beat and metre. Harmony studies how notes sound together, while melody is a sequence of pitches. Musical notation records these elements so performers can reproduce a piece." },
  { id: "knowledge-literature-genres", title: "Knowledge: Literature genres", content: "Fiction tells invented stories, while non-fiction presents factual accounts. A novel is a long work of prose fiction; a novella is shorter. Poetry often uses rhythm, imagery and compressed language. Drama is written for performance. A memoir recounts personal memories, and an essay explores a topic in prose. Genres can overlap and change over time." },
  { id: "knowledge-cooking-basics", title: "Knowledge: Cooking basics", content: "Cooking applies heat to food to improve flavour, texture and safety. Boiling uses water at about 100 degrees Celsius at sea level. Frying uses oil at higher temperatures. Baking surrounds food with dry heat in an oven. Cutting ingredients to similar sizes helps them cook evenly. Food safety includes washing hands, avoiding cross-contamination and cooking foods to safe temperatures." },
  { id: "knowledge-personal-budgeting", title: "Knowledge: Personal budgeting", content: "A budget compares expected income with planned spending. Start by listing regular income, fixed costs such as rent, and variable costs such as food and transport. Subtracting total spending from income shows whether there is a surplus or shortfall. An emergency fund covers unexpected costs. Reviewing a budget regularly helps reveal patterns and support realistic goals." },
  { id: "knowledge-first-aid-basics", title: "Knowledge: First aid basics", content: "First aid is immediate help given before professional medical care. Check that the scene is safe, call emergency services when needed, and avoid moving someone with a possible spinal injury unless they are in danger. For bleeding, apply firm direct pressure with a clean cloth. For burns, cool the area under cool running water. Formal first-aid training is the best way to learn these skills." },
  { id: "knowledge-home-maintenance", title: "Knowledge: Home maintenance", content: "Regular maintenance prevents small problems from becoming expensive ones. Clean gutters, replace air filters, check smoke alarms and inspect seals around doors and windows. Turn off water and power before many repairs, and use the correct tools for the task. Electrical, gas and structural work should be handled by qualified professionals when required." },
  { id: "knowledge-language-families", title: "Knowledge: Language families", content: "A language family is a group of languages related by descent from a common ancestor. Indo-European includes English, Spanish, French, German, Hindi and many others. Sino-Tibetan includes Chinese languages and Tibetan. Afroasiatic includes Arabic, Hebrew, Amharic and the Berber languages. Language families are studied by comparing sounds, grammar and vocabulary." },
  { id: "knowledge-translation-basics", title: "Knowledge: Translation basics", content: "Translation carries meaning from one language into another. A literal word-for-word version can miss idiom, tone or cultural context. A good translator first understands the whole message, then chooses wording that sounds natural in the target language. Differences in grammar, politeness and references often require restructuring. Review by a fluent speaker improves accuracy." },

  ...EXPANDED_LESSONS,
];

export const DICTIONARY_TOPICS = [
  "everyday", "noun", "verb", "adjective", "adverb", "technology", "science", "mathematics",
  "nature", "emotions", "communication", "education", "objects", "actions", "descriptive",
] as const;

export function normalizeWord(value: string): string {
  return value.toLowerCase().replace(/[^a-z']/g, "").trim();
}

interface BulkEntry { w: string; p: string; d: string; s?: string[]; r?: string[]; x?: string; t?: string[] }

function posFromBulk(value: string): DictionaryCategory {
  return (["noun", "verb", "adjective", "adverb", "pronoun", "article", "preposition", "conjunction", "other"] as const)
    .includes(value as DictionaryCategory) ? value as DictionaryCategory : "other";
}

function bulkToWord(entry: BulkEntry): DictionaryWord {
  const stamp = "2020-01-01T00:00:00.000Z";
  return {
    id: `bulk-${normalizeWord(entry.w)}-${entry.p}`,
    word: entry.w,
    definition: entry.d,
    partOfSpeech: posFromBulk(entry.p),
    example: entry.x ?? "",
    related: entry.r ?? [],
    synonyms: entry.s ?? [],
    topics: entry.t ?? [],
    source: "bundled",
    reviewStatus: "approved",
    createdAt: stamp,
    updatedAt: stamp,
    useCount: 0,
  };
}

/** Load the bundled 5,000-word dataset once. It is served locally from /public. */
export async function loadBulkDictionary(): Promise<DictionaryWord[]> {
  const response = await fetch("/data/english-dictionary.json", { cache: "force-cache" });
  if (!response.ok) throw new Error(`Dictionary dataset unavailable (${response.status}).`);
  const payload = await response.json() as { entries?: BulkEntry[] };
  if (!Array.isArray(payload.entries)) throw new Error("Dictionary dataset is malformed.");
  return payload.entries
    .filter((entry) => entry && typeof entry.w === "string" && typeof entry.d === "string")
    .map(bulkToWord);
}

/** Accept a bundled-format export or plain DictionaryWord objects. Duplicates are removed. */
export function parseDictionaryImport(json: string): DictionaryWord[] {
  const payload = JSON.parse(json) as unknown;
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : (payload && typeof payload === "object" && Array.isArray((payload as { entries?: unknown[] }).entries)
      ? (payload as { entries: unknown[] }).entries : []);
  const seen = new Set<string>();
  const out: DictionaryWord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    let word: DictionaryWord | null = null;
    if (typeof item.w === "string" && typeof item.d === "string") {
      word = { ...bulkToWord({ w: item.w, p: String(item.p ?? "noun"), d: item.d,
        s: Array.isArray(item.s) ? item.s.map(String) : [], r: Array.isArray(item.r) ? item.r.map(String) : [],
        x: typeof item.x === "string" ? item.x : "", t: Array.isArray(item.t) ? item.t.map(String) : [] }),
        id: makeImportId(String(item.w)), source: "imported" };
    } else if (typeof item.word === "string" && typeof item.definition === "string") {
      const stamp = typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString();
      word = {
        id: typeof item.id === "string" ? item.id : makeImportId(String(item.word)),
        word: String(item.word), definition: String(item.definition),
        partOfSpeech: posFromBulk(String(item.partOfSpeech ?? "noun")),
        example: typeof item.example === "string" ? item.example : "",
        related: Array.isArray(item.related) ? item.related.map(String) : [],
        synonyms: Array.isArray(item.synonyms) ? item.synonyms.map(String) : [],
        topics: Array.isArray(item.topics) ? item.topics.map(String) : [],
        source: "imported", reviewStatus: "approved",
        createdAt: stamp, updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : stamp,
        useCount: typeof item.useCount === "number" ? item.useCount : 0,
      };
    }
    if (!word) continue;
    const key = `${normalizeWord(word.word)}|${word.partOfSpeech}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

function makeImportId(word: string): string {
  return `import-${normalizeWord(word)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Words that would never carry useful dictionary meaning in a chat message. */
const MESSAGE_STOP = new Set([
  "a", "an", "the", "and", "or", "but", "is", "am", "are", "was", "were", "be", "been", "do", "does", "did",
  "to", "of", "in", "on", "at", "for", "with", "from", "my", "your", "this", "that", "it", "as", "so", "if",
  "what", "why", "how", "when", "where", "who", "can", "could", "would", "should", "will", "just", "about",
]);

export function seedDictionary(existing: DictionaryWord[]): DictionarySeed[] {
  const known = new Set(existing.map((word) => normalizeWord(word.word)));
  return SEED_WORDS.filter((seed) => !known.has(normalizeWord(seed.word)));
}

export function missingGrammarLessons(knowledge: KnowledgeEntry[]): GrammarSeed[] {
  const known = new Set(knowledge.map((entry) => entry.id));
  return GRAMMAR_LESSONS.filter((lesson) => !known.has(lesson.id));
}

export function searchDictionary(words: DictionaryWord[], query: string): DictionaryWord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return words;
  return words.filter((word) =>
    word.word.toLowerCase().includes(needle) ||
    word.definition.toLowerCase().includes(needle) ||
    word.example.toLowerCase().includes(needle) ||
    word.partOfSpeech.includes(needle) ||
    (word.synonyms ?? []).some((value) => value.toLowerCase().includes(needle)) ||
    (word.topics ?? []).some((value) => value.toLowerCase().includes(needle)) ||
    word.related.some((related) => related.toLowerCase().includes(needle)));
}

export function extractWords(message: string): string[] {
  const tokens = message.toLowerCase().replace(/[^a-z\s']/g, " ").split(/\s+/)
    .filter((token) => token.length > 1 && !MESSAGE_STOP.has(token));
  // "the current Canadian prime minister" is about the minister, not about the
  // electrical word "current". Keep the qualifier when it is the headword.
  return Array.from(new Set(withoutModifierWords(tokens, message)));
}

export interface DictionaryMatch {
  word: DictionaryWord;
  score: number;
}

/** Retrieve dictionary entries that are actually mentioned in the message. */
export function retrieveDictionary(message: string, words: DictionaryWord[]): DictionaryMatch[] {
  const targets = extractWords(message);
  const matches: DictionaryMatch[] = [];
  for (const word of words) {
    // Rejected user entries must not resurface as answers or training evidence.
    if (word.reviewStatus === "rejected") continue;
    const name = normalizeWord(word.word);
    if (!name) continue;
    let score = 0;
    if (targets.includes(name)) score = 4;
    else if (targets.some((target) => target.length > 2 && (name.includes(target) || target.includes(name)))) score = 2;
    else if (word.related.some((related) => targets.includes(normalizeWord(related)))) score = 1;
    else if ((word.synonyms ?? []).some((synonym) => targets.includes(normalizeWord(synonym)))) score = 1;
    if (score) matches.push({ word, score });
  }
  return matches.sort((a, b) => b.score - a.score);
}

export function retrieveGrammar(message: string, knowledge: KnowledgeEntry[]): KnowledgeEntry[] {
  const terms = Array.from(new Set(tokenize(message)));
  return knowledge
    .filter((entry) => entry.title.startsWith("Grammar:"))
    .map((entry) => {
      const entryTerms = new Set(tokenize(`${entry.title} ${entry.content}`));
      const score = terms.filter((term) => entryTerms.has(term)).length;
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.entry);
}

const SUBJECT_WORDS = new Set(["i", "you", "he", "she", "it", "we", "they", "sky", "world", "book", "dog", "cat", "friend", "english"]);
const PRONOUN_WORDS = new Set(["i", "you", "he", "she", "it", "we", "they", "me", "my", "your"]);
const LINKING_VERBS = new Set(["am", "is", "are", "was", "were", "be"]);
const COMMON_VERBS = new Set(["run", "read", "write", "eat", "drink", "walk", "play", "work", "open", "close", "see", "know", "think", "help", "use", "study"]);
const COMMON_NOUNS = new Set(["books", "book", "sky", "world", "english", "friend", "dog", "cat", "table", "water", "food", "school"]);
const ARTICLES = new Set(["a", "an", "the"]);
const ADJECTIVES = new Set(["blue", "red", "green", "big", "small", "careful", "interesting", "friendly", "happy"]);
const ADVERBS = new Set(["quickly", "carefully", "slowly", "today", "everyday", "always", "never"]);

export interface SentenceAnalysis {
  subject: string[];
  verbs: string[];
  object: string[];
  adjectives: string[];
  adverbs: string[];
  articles: string[];
  pattern: string;
  description: string;
  matches: DictionaryMatch[];
}

/** Rule-based analysis grounded in the user's actual dictionary entries. */
export function analyzeSentence(message: string, words: DictionaryWord[]): SentenceAnalysis {
  const matches = retrieveDictionary(message, words);
  const tokens = message.toLowerCase().replace(/[^a-z\s']/g, " ").split(/\s+/).filter(Boolean);
  const dictionaryVerbs = new Set(words.filter((word) => word.partOfSpeech === "verb").map((word) => normalizeWord(word.word)));
  const dictionaryNouns = new Set(words.filter((word) => word.partOfSpeech === "noun").map((word) => normalizeWord(word.word)));
  const dictionaryPronouns = new Set(words.filter((word) => word.partOfSpeech === "pronoun").map((word) => normalizeWord(word.word)));
  const verbs = tokens.filter((token) => LINKING_VERBS.has(token) || COMMON_VERBS.has(token) || dictionaryVerbs.has(token));
  const articles = tokens.filter((token) => ARTICLES.has(token));
  const adjectives = tokens.filter((token) => ADJECTIVES.has(token) || words.some((word) => word.partOfSpeech === "adjective" && normalizeWord(word.word) === token));
  const adverbs = tokens.filter((token) => ADVERBS.has(token) || token === "day" && message.toLowerCase().includes("every day"));
  const isNoun = (token: string) => SUBJECT_WORDS.has(token) || COMMON_NOUNS.has(token) || dictionaryNouns.has(token);
  const isPronoun = (token: string) => PRONOUN_WORDS.has(token) || dictionaryPronouns.has(token);
  const firstVerb = tokens.findIndex((token) => verbs.includes(token));
  const verbBoundary = firstVerb < 0 ? tokens.length : firstVerb;
  // Pronouns and nouns before the verb are subjects; nouns after it are objects.
  const subject = tokens.filter((token, index) => index < verbBoundary && (isPronoun(token) || isNoun(token)) && !articles.includes(token));
  const object = tokens.filter((token, index) => index > verbBoundary && isNoun(token) && !adjectives.includes(token) && !adverbs.includes(token));
  const hasObject = object.length > 0;
  const hasAdjective = adjectives.length > 0;
  const pattern = verbs.length && hasObject
    ? "Subject + Verb + Object" + (adverbs.length ? " + Additional information" : "")
    : verbs.length && hasAdjective ? "Subject + Verb + Adjective"
      : verbs.length ? "Subject + Verb" : "No complete sentence pattern found";
  const parts = [
    subject.length ? `subject ${subject.join(", ")}` : "",
    verbs.length ? `verb ${verbs.join(", ")}` : "",
    object.length ? `object ${object.join(", ")}` : "",
    adjectives.length ? `adjective ${adjectives.join(", ")}` : "",
    adverbs.length ? `additional information ${adverbs.join(", ")}` : "",
  ].filter(Boolean);
  const description = parts.length
    ? `I recognize ${parts.join(", ")}. This follows ${pattern}.`
    : `I can identify ${matches.map((match) => match.word.word).join(", ") || "no known words"} in that message.`;
  return { subject, verbs, object, adjectives, adverbs, articles, pattern, description, matches };
}

export function isNewWord(word: DictionaryWord, now = Date.now()): boolean {
  const created = Date.parse(word.createdAt);
  return Number.isFinite(created) && now - created < 7 * 24 * 60 * 60 * 1000;
}
