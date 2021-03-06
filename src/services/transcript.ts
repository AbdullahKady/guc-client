import { Browser, Page } from 'puppeteer';
import { TRANSCRIPT_URL } from '../constants';
import { TranscriptYear, TranscriptSemester } from './types';
import { createSlimPage } from '../utils';
import { EvaluationRequiredError } from './errors';

const crawlYearPage = (page: Page): Promise<Array<TranscriptSemester>> => {
  return page.$$eval('table [bordercolor="gainsboro"]', (elements: any) =>
    // Ignore empty years
    elements
      .filter(table => table.firstElementChild.children.length > 3)
      .map(table => {
        // Spread since the children is a collection, same result as Array.from()
        const rows: any = Array.from(table.firstElementChild.children);
        const name = rows[0].innerText.trim();
        const accumulatingRow: any = Array.from(rows.pop().children);
        const gpa = Number(accumulatingRow[2].innerText.trim());

        // Ignore the first 2 (headers)
        const courses = rows.slice(2).map(courseRow => ({
          name: courseRow.children[1].innerText.trim(),
          grade: {
            numeric: Number(courseRow.children[2].innerText.trim()),
            letter: courseRow.children[3].innerText.trim()
          },
          creditHours: Number(courseRow.children[4].innerText.trim())
        }));

        return {
          name,
          gpa,
          courses
        };
      })
  );
};

const extractYear = async (
  browser: Browser,
  { year, value }: { year: string; value: string },
  loginInfo: { username: string; password: string }
): Promise<TranscriptYear> => {
  const context = await browser.createIncognitoBrowserContext();
  const page = await createSlimPage(context);
  await page.authenticate(loginInfo);
  await page.goto(TRANSCRIPT_URL);
  await page.select('#stdYrLst', value);
  // Since the select fires a request, we need to wait for the response to render
  // This is just a text displaying the date in the resulting page.
  await page.waitForSelector('#dtLbl');
  const semesters = await crawlYearPage(page);
  await context.close();

  return {
    year,
    semesters
  };
};

const getTranscript = async (
  { username, password }: { username: string; password: string },
  browser: Browser
): Promise<Array<TranscriptYear>> => {
  const page = await createSlimPage(browser);
  await page.authenticate({ username, password });
  await page.goto(TRANSCRIPT_URL);
  if (await page.$eval('select', (element: any) => element.disabled)) {
    const { url, courses } = await page.evaluate(() => ({
      url: document.querySelector('a').href,
      courses: (document.querySelector('#msgLbl2') as HTMLSpanElement).innerText
        .split('\n')
        .slice(1, -1)
    }));
    throw new EvaluationRequiredError(url, courses);
  }

  const years = await page.$$eval(
    'option',
    nodes =>
      (nodes as Array<HTMLOptionElement>).map(n => ({ year: n.text, value: n.value })).slice(1) // Ignore the first element
  );

  const promises = years.map(year => extractYear(browser, year, { username, password }));

  const result = (await Promise.all(promises)).filter(({ semesters }) => semesters.length > 0);

  return result;
};

export { getTranscript };
