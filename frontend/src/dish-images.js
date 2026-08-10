// Real photos for a starter set of dishes, sourced from Wikimedia Commons
// (all Creative Commons licensed — attribution is shown under the photo
// in the recipe modal, which the CC BY-SA terms require).
//
// `file` is the Commons file name; Special:FilePath is Commons' stable
// redirect to the current full-size image, so we don't have to hardcode
// (and eventually break) a specific upload.wikimedia.org hash path.
//
// To add more dishes: find a CC-licensed photo on commons.wikimedia.org,
// copy its exact file name (the part after "File:"), and add an entry
// below keyed by the dish's `id` from backend/all_dishes_merged.json.
const COMMONS_BASE = "https://commons.wikimedia.org/wiki/Special:FilePath/";

function commons(file, credit, page) {
  return {
    url: `${COMMONS_BASE}${encodeURIComponent(file)}`,
    credit,
    creditUrl: page,
  };
}

export const DISH_IMAGES = {
  doro_wat: commons(
    "Injera and doro wat.jpg",
    "Wikimedia Commons, CC BY-SA 2.0",
    "https://commons.wikimedia.org/wiki/File:Injera_and_doro_wat.jpg"
  ),
  kitfo: commons(
    "Ethiopian Kitfo.JPG",
    "Kimtonga, Wikimedia Commons, CC BY-SA 4.0",
    "https://commons.wikimedia.org/wiki/File:Ethiopian_Kitfo.JPG"
  ),
  injera: commons(
    "Injera 2.jpg",
    "Franck Hidvégi, Wikimedia Commons, CC BY-SA 4.0",
    "https://commons.wikimedia.org/wiki/File:Injera_2.jpg"
  ),
  sambusa: commons(
    "Ethiopian Sambusa.jpg",
    "Wikimedia Commons, CC BY-SA 3.0",
    "https://commons.wikimedia.org/wiki/File:Ethiopian_Sambusa.jpg"
  ),
  shiro_wat: commons(
    "Taita and shiro.jpg",
    "Wikimedia Commons, CC BY-SA 2.5",
    "https://commons.wikimedia.org/wiki/File:Taita_and_shiro.jpg"
  ),
  buna: commons(
    "Coffee ceremony of Ethiopia and Eritrea 5.jpg",
    "Wikimedia Commons, CC BY-SA 4.0",
    "https://commons.wikimedia.org/wiki/File:Coffee_ceremony_of_Ethiopia_and_Eritrea_5.jpg"
  ),
};

export function getDishImage(id) {
  return DISH_IMAGES[id] || null;
}
