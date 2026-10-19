import { SCENES } from './core';
import type { Scene } from './core';

export type Lesson = {
  id: string;
  title: string;
  subtitle: string;
  sceneId: string;
  level: string;
  objectives: string[];
  prompt: string;
  greeting: string;
  translation: string;
  example: string;
};
export type CourseUnit = { id: string; title: string; description: string; lessons: Lesson[] };

/** 课程描述交际任务；实际对话仍由当前供应商用选定的练习语言生成。 */
export const COURSE_UNITS: CourseUnit[] = [
  {
    id: 'first-steps',
    title: '从一句话开始',
    description: '轻松回应，让对话继续下去',
    lessons: [
      {
        id: 'say-hello',
        title: '认识一个新朋友',
        subtitle: '介绍自己，也了解对方',
        sceneId: 'daily',
        level: 'A1',
        objectives: ['介绍自己', '分享一个爱好', '问对方一个问题'],
        prompt:
          'You have just met the learner at a neighborhood gathering. Help them introduce themselves, share a hobby, and ask you a question. Ask one simple question at a time.',
        greeting:
          'Hi, I’m {companion}. It’s nice to meet you! What do you like to do in your free time?',
        translation: '嗨，我是 {companion}，很高兴认识你！你空闲时喜欢做什么？',
        example: 'Nice to meet you! I enjoy cooking and going for walks. What about you?',
      },
      {
        id: 'your-day',
        title: '今天过得怎么样',
        subtitle: '从心情聊到生活里的小事',
        sceneId: 'daily',
        level: 'A1',
        objectives: ['说说今天的心情', '描述一件小事', '解释你的感受'],
        prompt:
          'Chat about the learner’s day. Invite them to describe a small event and how it made them feel. Keep questions easy and specific.',
        greeting: 'Hey! What was one good thing about your day?',
        translation: '嘿！今天有什么让你开心的小事？',
        example: 'I had lunch with a friend today. It was simple, but it made me happy.',
      },
      {
        id: 'cafe-order',
        title: '街角咖啡馆',
        subtitle: '点一杯自己喜欢的饮品',
        sceneId: 'travel',
        level: 'A2',
        objectives: ['点一杯饮品', '说明口味或大小', '确认价格与付款'],
        prompt:
          'Role-play a cafe barista. Help the learner order a drink, specify size or preferences, and ask about the price. Use a short realistic exchange.',
        greeting: 'Welcome in! What can I get started for you?',
        translation: '欢迎光临！想喝点什么？',
        example: 'Could I have a small latte with oat milk, please?',
      },
    ],
  },
  {
    id: 'out-and-about',
    title: '带着语言去旅行',
    description: '在陌生的地方，也能自在交流',
    lessons: [
      {
        id: 'travel-plan',
        title: '计划下一次旅行',
        subtitle: '聊目的地，也聊期待',
        sceneId: 'travel',
        level: 'A2',
        objectives: ['选择目的地', '说说想做的事', '询问一个建议'],
        prompt:
          'You are a friend planning a trip with the learner. Discuss a destination, an activity, and a practical travel suggestion.',
        greeting: 'If we could take a short trip next month, where would you like to go?',
        translation: '如果下个月能来一场短途旅行，你想去哪儿？',
        example: 'I’d love to visit Kyoto. I want to explore the old streets and try local food.',
      },
      {
        id: 'hotel-checkin',
        title: '顺利入住酒店',
        subtitle: '确认预订，问清需要的信息',
        sceneId: 'travel',
        level: 'A2',
        objectives: ['说明预订信息', '询问早餐时间', '提出一个需求'],
        prompt:
          'Role-play a hotel receptionist checking in the learner. Ask about their reservation and let them ask about breakfast and a room preference.',
        greeting: 'Good evening! Do you have a reservation with us?',
        translation: '晚上好！您有预订吗？',
        example: 'Yes, I have a reservation for two nights. Is breakfast included?',
      },
      {
        id: 'food-recommendation',
        title: '推荐一道招牌菜',
        subtitle: '像截图里那样，聊聊餐厅菜单',
        sceneId: 'travel',
        level: 'B1',
        objectives: ['介绍一道菜', '描述口味与食材', '按对方喜好推荐'],
        prompt:
          'You are a customer at the learner’s small restaurant. Ask them about their menu, ingredients and flavors, then ask for a recommendation based on your preferences.',
        greeting:
          'Your menu looks great! What would you recommend for someone who likes spicy food?',
        translation: '菜单看起来很棒！如果我喜欢辣味，你会推荐什么？',
        example: 'Our spicy chicken sandwich is very popular. You can choose a mild or hot sauce.',
      },
    ],
  },
  {
    id: 'work-together',
    title: '在工作中表达自己',
    description: '说清进展，也说出自己的想法',
    lessons: [
      {
        id: 'project-update',
        title: '两分钟项目近况',
        subtitle: '让同事听懂进展和下一步',
        sceneId: 'work',
        level: 'B1',
        objectives: ['介绍正在做的事', '说明进展或困难', '提出下一步计划'],
        prompt:
          'You are a supportive coworker. Ask for a short project update, discuss one obstacle, and agree on a next step.',
        greeting: 'How’s your project going? What have you been working on this week?',
        translation: '项目进展如何？这周主要在做些什么？',
        example:
          'We’ve finished the first draft. I’m checking the details before our next meeting.',
      },
      {
        id: 'make-suggestion',
        title: '提出一个好建议',
        subtitle: '礼貌表达，让建议更容易被接受',
        sceneId: 'work',
        level: 'B1',
        objectives: ['说明遇到的问题', '提出一个建议', '解释建议的好处'],
        prompt:
          'Discuss a team meeting that feels too long. Invite the learner to suggest an improvement, explain the benefit, and consider a practical constraint.',
        greeting:
          'Our team meetings have been running late. What could we do to make them more useful?',
        translation: '团队会议总是超时，怎样能让它更有效？',
        example:
          'How about sharing updates beforehand? That would give us more time for discussion.',
      },
      {
        id: 'polite-disagreement',
        title: '有分歧也能好好说',
        subtitle: '先回应，再解释自己的观点',
        sceneId: 'work',
        level: 'B2',
        objectives: ['回应对方的观点', '礼貌表达不同意见', '提出折中方案'],
        prompt:
          'Discuss whether every team member should work in the office every day. Hold a mild opposing view and encourage respectful disagreement and compromise.',
        greeting:
          'I think working together in the office every day helps the team. What’s your view?',
        translation: '我觉得每天一起在办公室工作有利于团队。你怎么看？',
        example:
          'I see your point, but a little flexibility could help people focus. Could we try a hybrid schedule?',
      },
    ],
  },
  {
    id: 'tell-your-story',
    title: '把故事讲得更生动',
    description: '分享经历，解释观点，聊得更深一点',
    lessons: [
      {
        id: 'past-experience',
        title: '一次难忘的经历',
        subtitle: '讲清发生了什么，以及你的感受',
        sceneId: 'ideas',
        level: 'B1',
        objectives: ['交代时间和地点', '描述事情经过', '分享收获或感受'],
        prompt:
          'Invite the learner to tell a memorable personal experience. Ask about the setting, what happened, and what they learned, one question per turn.',
        greeting: 'What’s an experience you still enjoy telling people about?',
        translation: '有什么经历，是你至今还乐于分享的？',
        example:
          'Last summer I traveled alone for the first time. I was nervous, but I learned to trust myself.',
      },
      {
        id: 'recommend-story',
        title: '安利一本书或一部电影',
        subtitle: '从“喜欢”说到“为什么喜欢”',
        sceneId: 'ideas',
        level: 'B1',
        objectives: ['介绍一部作品', '解释喜欢的原因', '回应一个追问'],
        prompt:
          'Ask for a book or movie recommendation. Explore the story without spoilers and ask why it matters personally to the learner.',
        greeting:
          'I’d love a good recommendation. Have you read or watched anything you really enjoyed?',
        translation: '想听听你的推荐。最近有什么喜欢的书或电影？',
        example:
          'I’d recommend this film because the characters feel so real. It made me think about my own choices.',
      },
      {
        id: 'future-change',
        title: '未来想尝试的改变',
        subtitle: '表达愿望，也讨论具体行动',
        sceneId: 'ideas',
        level: 'B2',
        objectives: ['描述想做的改变', '解释原因和阻碍', '说出一个可行的小步骤'],
        prompt:
          'Discuss a positive change the learner wants to make. Explore motivation, a realistic obstacle, and one small action they can take.',
        greeting: 'If you could make one small change to your routine, what would you choose?',
        translation: '如果能给日常生活做一个小改变，你会选什么？',
        example:
          'I’d like to spend less time on my phone. I could start by keeping it away during dinner.',
      },
    ],
  },
];

export const LESSONS = COURSE_UNITS.flatMap((unit) => unit.lessons);
export const LESSON_TURN_GOAL = 3;

/** 创建独立课程会话，复用半双工与两个教练，不改变用户选定的交流语言。 */
export function createLessonScene(lesson: Lesson): Scene {
  const base = SCENES.find((scene) => scene.id === lesson.sceneId) || SCENES[0];
  return {
    ...base,
    id: `lesson:${lesson.id}`,
    title: lesson.title,
    desc: lesson.subtitle,
    lessonId: lesson.id,
    goalTurns: LESSON_TURN_GOAL,
    prompt: lesson.prompt,
    greeting: lesson.greeting,
    translation: lesson.translation,
    example: lesson.example,
    angle: lesson.objectives[0],
    words: [],
  };
}
