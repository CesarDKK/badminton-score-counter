-- Udvider player_info.age_group med U23, UNG og senior-aargange -- ingen semikolon i kommentarer
ALTER TABLE player_info MODIFY age_group ENUM('U9','U11','U13','U15','U17','U19','U23','UNG','SEN','SEN+30','SEN+35','SEN+40','SEN+45','SEN+50','SEN+55','SEN+60','SEN+65','SEN+70','SEN+75','SEN+80') NOT NULL;
