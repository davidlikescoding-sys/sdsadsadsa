/** Build an expanded export by adding real dictionary entries to the user's data. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = JSON.parse(fs.readFileSync(path.join(root, "scripts", "trainer-export.json"), "utf8"));

// [word, definition, example] — all plain, common vocabulary so a tiny model can learn them.
const animals = [
  ["Lion", "A large wild cat that lives in Africa and hunts other animals", "The lion roars and sleeps in the shade"],
  ["Tiger", "A large wild cat with orange fur and dark stripes", "The tiger walks quietly through the forest"],
  ["Elephant", "A very large gray animal with a long trunk and big ears", "The elephant uses its trunk to drink water"],
  ["Giraffe", "A tall African animal with a very long neck and brown spots", "The giraffe eats leaves from the tall tree"],
  ["Zebra", "An African animal like a horse with black and white stripes", "The zebra runs across the grass"],
  ["Monkey", "A small animal that climbs trees and is close to humans", "The monkey swings from branch to branch"],
  ["Gorilla", "A large black ape that lives in African forests", "The gorilla is strong and gentle"],
  ["Bear", "A large furry animal that can stand on two legs", "The bear searches for berries in the forest"],
  ["Wolf", "A wild animal like a dog that lives and hunts in packs", "The wolf howls at night"],
  ["Fox", "A small wild animal with red fur and a bushy tail", "The fox is clever and quick"],
  ["Deer", "A gentle animal with long legs and antlers", "The deer eats grass near the trees"],
  ["Rabbit", "A small animal with long ears that hops", "The rabbit hides in the tall grass"],
  ["Squirrel", "A small animal with a bushy tail that climbs trees", "The squirrel stores nuts for winter"],
  ["Horse", "A large animal that people ride and that runs fast", "The horse gallops across the field"],
  ["Cow", "A large farm animal that gives milk", "The cow grazes in the green field"],
  ["Pig", "A pink farm animal that lives on a farm and eats a lot", "The pig rolls in the mud"],
  ["Sheep", "A farm animal with thick white wool", "The sheep sleeps in the warm barn"],
  ["Goat", "A farm animal with horns that climbs rocks", "The goat eats the grass on the hill"],
  ["Chicken", "A farm bird that lays eggs", "The chicken walks around the yard"],
  ["Duck", "A water bird with webbed feet that swims", "The duck swims in the pond"],
  ["Dog", "A friendly animal that people keep as a pet", "The dog runs to greet its owner"],
  ["Cat", "A small furry animal that people keep as a pet", "The cat sleeps on the warm chair"],
  ["Mouse", "A very small animal with a long thin tail", "The mouse hides behind the door"],
  ["Snake", "A long animal with no legs that slithers", "The snake moves through the grass"],
  ["Turtle", "A slow animal with a hard shell", "The turtle swims in the shallow water"],
  ["Frog", "A small green animal that jumps and lives near water", "The frog jumps into the pond"],
  ["Fish", "An animal that lives in water and swims with fins", "The fish swims in the clear lake"],
  ["Shark", "A large fish with sharp teeth that lives in the ocean", "The shark swims near the coral"],
  ["Whale", "A very large animal that lives in the ocean and breathes air", "The whale dives deep into the sea"],
  ["Dolphin", "A smart ocean animal that jumps out of the water", "The dolphin swims beside the boat"],
  ["Octopus", "A sea animal with eight arms", "The octopus hides among the rocks"],
  ["Bird", "An animal with feathers and wings that can fly", "The bird sings in the tree"],
  ["Eagle", "A large bird with a hooked beak that flies high", "The eagle circles above the mountain"],
  ["Owl", "A bird with big eyes that hunts at night", "The owl looks down from the tall tree"],
  ["Parrot", "A colorful bird that can copy sounds", "The parrot repeats the word hello"],
  ["Penguin", "A black and white bird that swims but cannot fly", "The penguin slides on the ice"],
  ["Kangaroo", "An Australian animal that hops on strong back legs", "The kangaroo carries its baby in a pouch"],
  ["Panda", "A black and white bear that eats bamboo", "The panda sits and eats bamboo"],
  ["Leopard", "A wild cat with spots that climbs trees", "The leopard rests on a tree branch"],
  ["Camel", "A desert animal with one or two humps", "The camel walks across the hot sand"],
];

const fruits = [
  ["Apple", "A round fruit with red or green skin and crisp flesh", "She eats a red apple after lunch"],
  ["Banana", "A long yellow fruit that is soft and sweet", "He peels a banana for breakfast"],
  ["Orange", "A round orange fruit with juicy sections", "The orange is full of sweet juice"],
  ["Grape", "A small round fruit that grows in bunches", "She picks a grape from the bunch"],
  ["Strawberry", "A small red fruit with seeds on the outside", "The strawberry tastes sweet and juicy"],
  ["Blueberry", "A small dark blue fruit that grows on bushes", "He adds blueberries to his cereal"],
  ["Mango", "A sweet yellow fruit with a large stone", "The mango is ripe and sweet"],
  ["Pineapple", "A large yellow fruit with a spiky green top", "The pineapple tastes sweet and sour"],
  ["Peach", "A soft fruit with fuzzy skin and a large pit", "The peach is sweet and juicy"],
  ["Pear", "A fruit that is narrow at the top and round at the bottom", "She cuts a pear into slices"],
  ["Plum", "A small dark purple fruit with smooth skin", "The plum is sweet and tart"],
  ["Cherry", "A small round red fruit with a thin stem", "He eats a cherry from the bowl"],
  ["Lemon", "A sour yellow fruit used for juice", "She adds lemon to her tea"],
  ["Watermelon", "A very large green fruit with red juicy flesh", "The watermelon is cool and sweet"],
  ["Papaya", "A large orange fruit with soft flesh and black seeds", "The papaya is soft and sweet"],
  ["Kiwi", "A small brown fruit with green flesh and black seeds", "She cuts a kiwi with a spoon"],
  ["Avocado", "A green fruit with a large pit and soft flesh", "He puts avocado on his toast"],
  ["Coconut", "A large brown fruit with a hard shell and white flesh", "The coconut grows on tall palms"],
  ["Fig", "A small soft fruit with many tiny seeds", "The fig is sweet and sticky"],
  ["Blackberry", "A dark fruit made of small round parts", "She picks a blackberry from the bush"],
  ["Pomegranate", "A round fruit with many red seeds inside", "The pomegranate has juicy red seeds"],
  ["Grapefruit", "A large yellow fruit that tastes sour and sweet", "He eats half a grapefruit"],
  ["Apricot", "A small orange fruit like a small peach", "The apricot is soft and sweet"],
  ["Lime", "A small green sour fruit used for juice", "She squeezes lime into the water"],
  ["Raspberry", "A small red fruit made of tiny parts", "The raspberry is sweet and tart"],
  ["Cantaloupe", "A round orange fruit with sweet flesh", "The cantaloupe smells sweet"],
  ["Date", "A small brown sweet fruit that grows on palms", "The date is chewy and sweet"],
  ["Guava", "A round green fruit with pink flesh and seeds", "The guava tastes sweet and tangy"],
];

const objects = [
  ["Chair", "A piece of furniture with a seat and a back that you sit on", "He sits on the wooden chair"],
  ["Table", "A flat piece of furniture with legs used for working or eating", "She puts the book on the table"],
  ["Bed", "A piece of furniture that you sleep on", "The bed is soft and warm"],
  ["Sofa", "A long soft seat for several people", "They sit on the sofa to watch television"],
  ["Desk", "A table used for writing or working", "His computer sits on the desk"],
  ["Lamp", "A device that gives light", "She turns on the lamp to read"],
  ["Clock", "A device that shows the time", "The clock on the wall says ten"],
  ["Mirror", "A glass that shows your reflection", "He looks in the mirror"],
  ["Window", "An opening in a wall that lets in light", "She opens the window for fresh air"],
  ["Door", "A movable barrier used to enter a room", "He closes the door quietly"],
  ["Key", "A small metal object used to open a lock", "She uses the key to open the door"],
  ["Lock", "A device that keeps a door or box closed", "The key turns in the lock"],
  ["Phone", "A device used to call people and send messages", "He answers the phone"],
  ["Computer", "A machine that can store and process information", "She works on her computer"],
  ["Keyboard", "A set of keys used to type on a computer", "He types on the keyboard"],
  ["Screen", "The flat part of a device that shows images", "The screen is bright and clear"],
  ["Television", "A device that shows programs and videos", "They watch television in the evening"],
  ["Camera", "A device used to take photographs", "She takes a photo with her camera"],
  ["Watch", "A small device worn on the wrist that shows time", "He checks his watch"],
  ["Umbrella", "A folded cover held over the head to keep off rain", "She opens her umbrella in the rain"],
  ["Backpack", "A bag worn on the back to carry things", "He puts his books in the backpack"],
  ["Book", "A set of written pages that you read", "She reads a book before bed"],
  ["Pen", "A tool used to write with ink", "He writes his name with a pen"],
  ["Pencil", "A tool used to write or draw with graphite", "She draws with a pencil"],
  ["Paper", "Thin material used for writing or printing", "He writes on a sheet of paper"],
  ["Cup", "A small container used for drinking", "She drinks tea from a cup"],
  ["Plate", "A flat dish used for serving food", "He puts the food on the plate"],
  ["Bowl", "A deep round dish used for soup or cereal", "She eats cereal from a bowl"],
  ["Spoon", "A tool with a small bowl used for eating", "He stirs his tea with a spoon"],
  ["Fork", "A tool with prongs used for eating", "She picks up food with a fork"],
  ["Knife", "A tool with a sharp blade used for cutting", "He cuts the bread with a knife"],
  ["Pot", "A deep container used for cooking", "The soup cooks in the pot"],
  ["Pan", "A shallow container used for frying food", "She fries an egg in the pan"],
  ["Bottle", "A container with a narrow neck used for liquids", "He drinks water from a bottle"],
  ["Glass", "A clear container used for drinking", "She pours juice into a glass"],
  ["Towel", "A piece of cloth used for drying", "He dries his hands with a towel"],
  ["Soap", "A block or liquid used for washing", "She washes with soap and water"],
  ["Toothbrush", "A small brush used to clean teeth", "He brushes his teeth with a toothbrush"],
  ["Scissors", "A tool with two blades used for cutting", "She cuts the paper with scissors"],
  ["Shirt", "A piece of clothing worn on the upper body", "He wears a blue shirt"],
  ["Pants", "Clothing worn on the legs", "She puts on her pants"],
  ["Jacket", "A warm piece of clothing worn over a shirt", "He wears a jacket in the cold wind"],
  ["Shoes", "Coverings worn on the feet", "She ties her shoes"],
  ["Hat", "A covering worn on the head", "He wears a hat in the sun"],
  ["Belt", "A strip worn around the waist", "She fastens her belt"],
  ["Car", "A road vehicle with four wheels and an engine", "He drives the car to work"],
  ["Bus", "A large vehicle that carries many passengers", "She takes the bus to school"],
  ["Bicycle", "A vehicle with two wheels that you pedal", "He rides his bicycle in the park"],
  ["Train", "A vehicle that runs on tracks and carries people", "The train arrives at the station"],
  ["Airplane", "A flying vehicle with wings", "The airplane flies above the clouds"],
  ["Boat", "A small vehicle that floats on water", "They cross the lake in a boat"],
  ["House", "A building where people live", "Their house has a red door"],
  ["Refrigerator", "A cold cabinet used to keep food fresh", "She puts the milk in the refrigerator"],
  ["Stove", "A device used for cooking food", "He cooks dinner on the stove"],
  ["Fan", "A device with blades that moves air to keep you cool", "She turns on the fan in summer"],
  ["Broom", "A tool with a long handle used for sweeping", "He sweeps the floor with a broom"],
];

const math = [
  ["Plus", "The operation of adding one number to another, shown by the plus sign", "Five plus three equals eight", "noun"],
  ["Minus", "The operation of subtracting one number from another, shown by the minus sign", "Nine minus four equals five", "noun"],
  ["Plus sign", "The symbol plus used to show addition between numbers", "The expression five plus three uses a plus sign", "noun"],
  ["Minus sign", "The symbol minus used to show subtraction between numbers", "The expression nine minus four uses a minus sign", "noun"],
  ["Multiplied by", "A phrase that means one number is multiplied by another number", "Six multiplied by seven equals forty two", "other"],
  ["Divided by", "A phrase that means one number is split into equal parts by another number", "Twenty divided by four equals five", "other"],
  ["Addition", "The operation of combining numbers to find their total sum", "Addition uses the plus sign", "noun"],
  ["Subtraction", "The operation of taking one number away from another to find the difference", "Subtraction uses the minus sign", "noun"],
  ["Multiplication", "The operation of repeated addition that finds a product", "Multiplication can be written with the times sign", "noun"],
  ["Division", "The operation of splitting a number into equal parts to find a quotient", "Division can be written with the slash sign", "noun"],
  ["Add", "To combine numbers or amounts so that they form a total", "Add five and three to get eight", "verb"],
  ["Subtract", "To take one number or amount away from another to find the difference", "Subtract four from nine to get five", "verb"],
  ["Multiply", "To add a number to itself a given number of times", "Multiply six by seven to get forty two", "verb"],
  ["Divide", "To split a number into equal parts or groups", "Divide twenty by four to get five", "verb"],
  ["Equals", "A word that says two amounts or expressions have the same value", "Five plus three equals eight", "verb"],
  ["Times", "A word used to say how many times one number is multiplied by another", "Six times seven equals forty two", "other"],
  ["Sum", "The result when numbers are added together", "The sum of five and three is eight", "noun"],
  ["Difference", "The result when one number is subtracted from another", "The difference between nine and four is five", "noun"],
  ["Product", "The result when numbers are multiplied together", "The product of six and seven is forty two", "noun"],
  ["Quotient", "The result when one number is divided by another", "The quotient of twenty divided by four is five", "noun"],
];

// [word, definition, example, partOfSpeech] — coding vocabulary shared by
// JavaScript and Python so the tiny word model can learn real programming words.
const coding = [
  ["JavaScript", "A programming language used to add interactive behaviour to web pages and to build applications", "JavaScript can change the text on a web page when you click a button", "noun"],
  ["Python", "A programming language known for its simple readable syntax and wide use in data work and automation", "Python uses indentation to show the structure of a program", "noun"],
  ["Variable", "A named place in a program that stores a value which can change while the program runs", "A variable named age can store the number ten", "noun"],
  ["Constant", "A named value in a program that does not change after it is set", "In JavaScript, const declares a constant", "noun"],
  ["Function", "A named block of code that performs a task and can be used again and again", "A function can add two numbers and return the result", "noun"],
  ["Parameter", "A value passed into a function so the function can use it when it runs", "The function takes a name as a parameter", "noun"],
  ["Return", "To send a result from a function back to the part of the program that called it", "The function returns the sum of two numbers", "verb"],
  ["Loop", "A piece of code that repeats its instructions until a condition says to stop", "A loop can print the numbers from one to ten", "noun"],
  ["Array", "An ordered list of values stored together so a program can work with them", "An array can hold the colours red, green and blue", "noun"],
  ["String", "A sequence of characters used in a program to represent text", "The word hello inside quotes is a string", "noun"],
  ["Boolean", "A data type that has one of two values, true or false", "The comparison five is greater than three gives a boolean result", "noun"],
  ["Integer", "A whole number data type with no fractional part", "The numbers five and minus three are integers", "noun"],
  ["Condition", "An expression that is either true or false and controls which code runs", "If the condition is true, the program prints a message", "noun"],
  ["Class", "A blueprint in object oriented programming that defines the properties and methods of its objects", "A class named Dog can create objects for different dogs", "noun"],
  ["Object", "A collection of related values and behaviours that a program can use as one thing", "An object can store a person name and age together", "noun"],
  ["Method", "A function that belongs to an object or a class", "The method upper changes a Python string to capital letters", "noun"],
  ["Comment", "Text in source code that the computer ignores and that explains the code to people", "In Python, a hash symbol starts a comment", "noun"],
  ["Syntax", "The set of rules that says how instructions must be written in a programming language", "Python uses indentation as part of its syntax", "noun"],
  ["Bug", "A mistake in a program that makes it behave in a way the programmer did not intend", "A bug caused the wrong number to be printed", "noun"],
  ["Debug", "To find and remove mistakes from a program so it works correctly", "The programmer debugs the code by printing values", "verb"],
  ["Compiler", "A tool that translates a whole program into lower level code before it runs", "A compiler turns source code into machine instructions", "noun"],
  ["Interpreter", "A tool that carries out a program instructions step by step without first compiling the whole program", "Python usually runs through an interpreter", "noun"],
  ["Library", "A collection of reusable code that a program can call to perform common tasks", "A math library can provide square root and random numbers", "noun"],
  ["Module", "A file of code that can be imported and reused by other programs", "Python programs import modules to use extra functions", "noun"],
  ["Import", "To bring code from another module or library into the program you are writing", "Python uses the import statement to load a module", "verb"],
  ["Export", "To make code from one module available so other programs can use it", "JavaScript uses export to share a function between files", "verb"],
  ["Operator", "A symbol or word that tells a program to perform an operation on values", "The plus operator adds two numbers", "noun"],
  ["Algorithm", "A finite set of clear steps for solving a problem or completing a task", "A sorting algorithm puts a list of numbers in order", "noun"],
  ["Print", "To display text or a value from a program on the screen", "Python uses print to show a message", "verb"],
  ["Console", "A tool in a browser or terminal that shows a program output and error messages", "JavaScript can write a message to the browser console", "noun"],
  ["Data type", "The kind of value a variable can hold, such as a number, string or boolean", "A string and an integer are two different data types", "noun"],
  ["If statement", "Code that runs a block only when its condition is true", "An if statement can check whether a number is positive", "noun"],
  ["For loop", "A loop that repeats a block a known number of times or once for each item in a collection", "A for loop can visit every item in an array", "noun"],
  ["While loop", "A loop that repeats a block as long as its condition stays true", "A while loop can count down from ten to one", "noun"],
];

// Game development vocabulary for building interactive games.
const games = [
  ["Game", "A system with rules and goals where players take actions and try to win", "A game can be played on a computer or in a browser", "noun"],
  ["Sprite", "A two dimensional image used for a character or object in a game", "The player sprite moves across the screen", "noun"],
  ["Collision", "An event in a game when two objects touch or overlap each other", "A collision between the player and an enemy can reduce health", "noun"],
  ["Score", "The number of points a player has earned in a game", "The score increases when the player collects a coin", "noun"],
  ["Level", "A stage or section of a game with its own challenge and goals", "The player reaches the next level after finishing the first one", "noun"],
  ["Player", "The character or person taking part in a game", "The player moves left and right with the arrow keys", "noun"],
  ["Enemy", "A character or obstacle in a game that the player must avoid or defeat", "The enemy follows the player across the screen", "noun"],
  ["Animation", "A sequence of images shown quickly to create the idea of movement", "The animation shows the character running", "noun"],
  ["Physics", "Rules in a game that control motion, gravity, speed and collisions", "Game physics makes the ball fall to the ground", "noun"],
  ["Game loop", "The repeating cycle in a game that reads input, updates state and draws the screen", "The game loop runs once per frame", "noun"],
  ["Input", "Signals from a keyboard, mouse or touchscreen that a program reads", "The game reads input from the arrow keys", "noun"],
  ["Hitbox", "An invisible area used to detect collisions between objects in a game", "The hitbox around the sprite is larger than the image", "noun"],
  ["Coordinate", "A pair of numbers that gives a position on a grid or screen", "The coordinate x ten y twenty places the sprite on screen", "noun"],
  ["Frame", "One still image in a sequence that together makes an animation", "The game draws sixty frames every second", "noun"],
  ["Restart", "To begin a game or program again from the start", "The player can restart the game after losing", "verb"],
];

// Website development vocabulary for building pages and web applications.
const web = [
  ["HTML", "The markup language that gives a web page its structure using elements and tags", "HTML uses the paragraph tag to mark a paragraph", "noun"],
  ["CSS", "The stylesheet language that controls the colours, fonts and layout of a web page", "CSS can change the background colour of a button", "noun"],
  ["DOM", "The document object model that lets JavaScript read and change web page elements", "JavaScript uses the DOM to change a paragraph", "noun"],
  ["Element", "A single part of a web page such as a paragraph, image or button", "The button is an element on the page", "noun"],
  ["Tag", "A marker in HTML that defines the start and end of an element", "The paragraph tag wraps a block of text", "noun"],
  ["Attribute", "Extra information added to an HTML tag, such as a class or an id", "The class attribute helps CSS find an element", "noun"],
  ["Selector", "A pattern in CSS that chooses which elements to style", "A class selector styles every element with that class", "noun"],
  ["Style", "The visual rules such as colour, size and spacing applied to a web page", "CSS controls the style of the heading", "noun"],
  ["Layout", "The arrangement of elements on a web page", "A flex layout can place items in a row", "noun"],
  ["Responsive", "A design that adapts to different screen sizes such as phones and desktops", "A responsive layout changes when the screen is narrow", "adjective"],
  ["Event", "An action such as a click or key press that a program can respond to", "A click event runs a function when the button is pressed", "noun"],
  ["Listener", "A function that waits for an event and runs when the event happens", "An event listener responds to a button click", "noun"],
  ["Form", "A group of inputs on a web page that a user fills in and submits", "The form has fields for a name and email address", "noun"],
  ["Fetch", "A JavaScript function that requests data from a server over the web", "JavaScript can fetch data from an API and display it", "verb"],
  ["API", "An interface that lets one program communicate with another through defined requests", "A web API can return weather data as JSON", "noun"],
  ["JSON", "A text format for exchanging structured data with keys and values", "The API returns a JSON object with a name and age", "noun"],
  ["Route", "A URL path that maps to a particular page or action in a web application", "The route slash about shows the about page", "noun"],
  ["Component", "A reusable piece of a web interface that groups its own structure and behaviour", "A button component can be used on many pages", "noun"],
  ["Browser", "A program that displays web pages and runs their HTML, CSS and JavaScript", "The browser loads the page and shows the text", "noun"],
  ["Server", "A computer that delivers web pages and data to browsers over a network", "The server sends the page when the browser requests it", "noun"],
];

const groups = { animals, fruits, objects, math, coding, games, web };
const stamp = new Date().toISOString();
const existing = new Set(src.data.dictionary.map((w) => w.word.toLowerCase()));
const added = [];
for (const [topic, rows] of Object.entries(groups)) {
  for (const [word, definition, example, partOfSpeech] of rows) {
    if (existing.has(word.toLowerCase())) continue;
    existing.add(word.toLowerCase());
    added.push({
      id: `teach-${topic}-${word.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      word,
      definition: `${definition}.`,
      partOfSpeech: partOfSpeech ?? "noun",
      example: `${example}.`,
      related: [],
      synonyms: [],
      topics: [topic],
      source: "teaching",
      reviewStatus: "approved",
      createdAt: stamp,
      updatedAt: stamp,
      useCount: 0,
    });
  }
}
src.data.dictionary.push(...added);

// A category overview per topic makes each word appear more often, which is
// needed for a 2k-vocabulary tiny model to actually store the new words.
const overviews = [
  ["Animals", "Common animals include lion, tiger, elephant, giraffe, zebra, monkey, bear, wolf, fox, deer, rabbit, horse, cow, pig, sheep, goat, dog, cat, fish, bird, frog and turtle. A lion is a wild cat. A tiger has stripes. An elephant has a trunk. A giraffe has a long neck. A dog and a cat are pets."],
  ["Fruits", "Common fruits include apple, banana, orange, grape, strawberry, mango, pineapple, peach, pear, cherry, lemon, watermelon, kiwi and avocado. An apple is round. A banana is long and yellow. An orange is juicy. A strawberry is small and red. A mango is sweet."],
  ["Everyday objects", "Common objects at home include chair, table, bed, sofa, desk, lamp, clock, mirror, window, door, key, phone, book, pen, cup, plate, spoon, fork, towel and broom. You sit on a chair. You sleep in a bed. You read a book. You write with a pen. You eat with a spoon."],
  ["Math operations", "Plus means addition and uses the plus sign. Five plus three equals eight. Minus means subtraction and uses the minus sign. Nine minus four equals five. Multiplied by and times mean multiplication. Six multiplied by seven equals forty two. Divided by means division. Twenty divided by four equals five. Addition gives a sum, subtraction gives a difference, multiplication gives a product and division gives a quotient."],
  ["Coding", "JavaScript adds behaviour to web pages, and Python is known for readable syntax. A variable stores a value that can change, while a constant holds a value that does not change. A function is a reusable block of code that takes parameters and returns a result. An array holds an ordered list, and a string holds text. A boolean is true or false, and an integer is a whole number. An if statement runs code when a condition is true, and a loop repeats code. A comment explains code, and syntax is the set of rules for writing it. A bug is a mistake that you debug. A compiler translates a whole program, while an interpreter runs it step by step. A library is reusable code, a module is a file of code, import brings code in and export shares it. An operator performs an operation, and an algorithm is a set of steps. Print shows output, and the console displays output and errors."],
  ["Games", "A game has rules, a player, enemies, a score and levels. The game loop runs once per frame and reads input, updates state and draws sprites. A sprite is the image for a player or enemy. A collision is when two hitboxes overlap, and hitboxes are invisible areas used for collision detection. Animation shows movement by stepping through frames. Physics controls gravity, speed and movement using coordinates. The score rises when goals are met, the next level begins when a level is finished, and a win condition or restart ends the game."],
  ["Websites", "A website uses HTML for structure, CSS for style and layout, and JavaScript for behaviour. HTML elements are written with tags and attributes such as a class or id. CSS selectors choose elements and apply styles, and a responsive layout adapts to different screen sizes. The DOM lets JavaScript find and change elements. An event such as a click triggers a listener function. A form collects input, and fetch requests data from an API. The API returns JSON, routes map URL paths to pages, and a component is a reusable interface piece. The browser loads the page from a server and shows it."],
];

// A tiny 2k vocabulary needs about 12 uses of a word before it is kept.
// These short drills give every new word enough real appearances to be stored.
const drillTemplates = [
  (w) => `A ${w} is a ${w}.`,
  (w) => `The ${w} is here.`,
  (w) => `I see a ${w}.`,
  (w) => `This is a ${w}.`,
  (w) => `A ${w} is common.`,
  (w) => `I know the ${w}.`,
  (w) => `The ${w} is useful.`,
  (w) => `A ${w} can be big.`,
];
const mathDrillTemplates = [
  (w) => `I learn the math word ${w}.`,
  (w) => `The word ${w} is important in math.`,
  (w) => `This lesson teaches ${w}.`,
  (w) => `I practice ${w} today.`,
  (w) => `A student should know ${w}.`,
  (w) => `I can explain ${w}.`,
  (w) => `The phrase ${w} appears in arithmetic.`,
  (w) => `I remember ${w} after practice.`,
];
const codingDrillTemplates = [
  (w) => `I learn the coding word ${w}.`,
  (w) => `The word ${w} is important in programming.`,
  (w) => `This coding lesson teaches ${w}.`,
  (w) => `I practice ${w} in JavaScript and Python.`,
  (w) => `A programmer should know ${w}.`,
  (w) => `I can explain ${w} with an example.`,
  (w) => `The phrase ${w} appears in code.`,
  (w) => `I remember ${w} after writing code.`,
];
const buildingDrillTemplates = [
  (w) => `I learn the word ${w}.`,
  (w) => `The word ${w} is important when building.`,
  (w) => `This lesson teaches ${w}.`,
  (w) => `I practice ${w} in my project.`,
  (w) => `A builder should know ${w}.`,
  (w) => `I can explain ${w} with an example.`,
  (w) => `The word ${w} appears in the project.`,
  (w) => `I remember ${w} after building.`,
];
for (const [topic, rows] of Object.entries(groups)) {
  const words = rows.map(([word]) => word);
  const sentences = [];
  const templates = topic === "math" ? mathDrillTemplates : topic === "coding" ? codingDrillTemplates : (topic === "games" || topic === "web") ? buildingDrillTemplates : drillTemplates;
  for (const w of words) for (const t of templates) sentences.push(t(w));
  overviews.push([
    `Word practice: ${topic}`,
    `Practice these ${topic} words out loud. ${sentences.join(" ")}`,
  ]);
}
for (const [title, content] of overviews) {
  src.data.knowledge.push({
    id: `teach-overview-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    category: "Teaching",
    title: `Common ${title}`,
    content,
    createdAt: stamp,
    updatedAt: stamp,
  });
}

// Worked examples are real Q&A training data, not runtime answer templates.
// The local calculator still computes every numeric answer independently.
src.data.datasets.push({
  id: "teach-math-practice",
  name: "Math practice",
  description: "Arithmetic vocabulary and worked calculation examples.",
  content: [
    "MATH PRACTICE",
    "User: What does plus mean?",
    "DavidAI: Plus means addition, which combines numbers to find a total.",
    "User: What does minus mean?",
    "DavidAI: Minus means subtraction, which takes one number away from another.",
    "User: What does multiplied by mean?",
    "DavidAI: Multiplied by means one number is multiplied by another number.",
    "User: What does divided by mean?",
    "DavidAI: Divided by means one number is split into equal parts by another number.",
    "User: What is 5 plus 3?",
    "DavidAI: The result is 8.",
    "User: What is 9 minus 4?",
    "DavidAI: The result is 5.",
    "User: What is 6 multiplied by 7?",
    "DavidAI: The result is 42.",
    "User: What is 20 divided by 4?",
    "DavidAI: The result is 5.",
    "User: What is 5 + 3?",
    "DavidAI: The result is 8.",
    "User: What is 9 - 4?",
    "DavidAI: The result is 5.",
  ].join("\n"),
});

src.data.datasets.push({
  id: "teach-coding-practice",
  name: "Coding practice",
  description: "JavaScript and Python vocabulary with worked coding examples.",
  content: [
    "CODING PRACTICE",
    "User: What does JavaScript mean?",
    "DavidAI: JavaScript is a programming language used to add interactive behaviour to web pages and to build applications.",
    "User: What does Python mean?",
    "DavidAI: Python is a programming language known for readable syntax and wide use in data work and automation.",
    "User: What does variable mean?",
    "DavidAI: A variable is a named place in a program that stores a value which can change while the program runs.",
    "User: What does function mean?",
    "DavidAI: A function is a named block of code that performs a task and can be used again and again.",
    "User: What does loop mean?",
    "DavidAI: A loop is a piece of code that repeats its instructions until a condition says to stop.",
    "User: What does array mean?",
    "DavidAI: An array is an ordered list of values stored together so a program can work with them.",
    "User: What does string mean?",
    "DavidAI: A string is a sequence of characters used in a program to represent text.",
    "User: What does boolean mean?",
    "DavidAI: A boolean is a data type that has one of two values, true or false.",
    "User: What does if statement mean?",
    "DavidAI: An if statement is code that runs a block only when its condition is true.",
    "User: How do you print in Python?",
    "DavidAI: In Python, you use the print function to display a message on the screen.",
    "User: How do you write a message to the console in JavaScript?",
    "DavidAI: In JavaScript, you use console.log to write a message to the browser console.",
  ].join("\n"),
});

src.data.datasets.push({
  id: "teach-game-development",
  name: "Game development",
  description: "Game development vocabulary and worked examples for building games.",
  content: [
    "GAME DEVELOPMENT",
    "User: How do you make a game?",
    "DavidAI: A game has a game loop that runs once per frame. Each frame reads input, updates the player and enemies, checks collisions between sprites with hitboxes, and draws the screen. The score and levels track progress, and a win condition or restart ends the game.",
    "User: What is a game loop?",
    "DavidAI: A game loop is the repeating cycle that reads input, updates game state and draws the screen once per frame.",
    "User: What is a sprite?",
    "DavidAI: A sprite is a two dimensional image used for a character or object in a game.",
    "User: What is a collision?",
    "DavidAI: A collision is when two objects in a game touch or overlap, usually detected with invisible hitboxes.",
    "User: What is a hitbox?",
    "DavidAI: A hitbox is an invisible area around a sprite used to detect collisions.",
    "User: What does animation mean in a game?",
    "DavidAI: Animation shows movement by stepping through a sequence of frames in order.",
    "User: What does game physics do?",
    "DavidAI: Game physics controls motion, gravity, speed and collisions using coordinates.",
    "User: How does a game know the player won?",
    "DavidAI: A win condition is the rule that decides when the player has won, such as reaching a target score or finishing a level.",
  ].join("\n"),
});

src.data.datasets.push({
  id: "teach-web-development",
  name: "Website development",
  description: "Website development vocabulary and worked examples for building pages.",
  content: [
    "WEBSITE DEVELOPMENT",
    "User: How do you build a website?",
    "DavidAI: A website uses HTML for structure, CSS for style and layout, and JavaScript for behaviour. Elements are written with tags and attributes, CSS selectors style them, and the DOM lets JavaScript respond to events such as clicks. Forms and fetch requests connect the page to an API that returns JSON.",
    "User: What is HTML?",
    "DavidAI: HTML is the markup language that gives a web page its structure using elements and tags.",
    "User: What is CSS?",
    "DavidAI: CSS is the stylesheet language that controls the colours, fonts and layout of a web page.",
    "User: What is the DOM?",
    "DavidAI: The DOM is the document object model that lets JavaScript read and change web page elements.",
    "User: What is a selector?",
    "DavidAI: A selector is a pattern in CSS that chooses which elements to style.",
    "User: What is an event listener?",
    "DavidAI: A listener is a function that waits for an event such as a click and runs when the event happens.",
    "User: What does fetch do?",
    "DavidAI: Fetch is a JavaScript function that requests data from a server over the web.",
    "User: What is JSON?",
    "DavidAI: JSON is a text format for exchanging structured data with keys and values.",
    "User: What is a responsive layout?",
    "DavidAI: A responsive layout adapts to different screen sizes such as phones and desktops.",
  ].join("\n"),
});

const target = path.join(root, "scripts", "teach-export.json");
fs.writeFileSync(target, JSON.stringify(src, null, 2));
console.log(JSON.stringify({ addedEntries: added.length, dictionary: src.data.dictionary.length, knowledge: src.data.knowledge.length, datasets: src.data.datasets.length, file: target }));
