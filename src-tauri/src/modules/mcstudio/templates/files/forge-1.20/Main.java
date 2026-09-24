package {{package}};

import {{package}}.registry.ModBlocks;
import {{package}}.registry.ModItems;
import com.mojang.logging.LogUtils;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import org.slf4j.Logger;

@Mod({{main_class}}.MOD_ID)
public class {{main_class}} {
    public static final String MOD_ID = "{{mod_id}}";
    public static final Logger LOGGER = LogUtils.getLogger();

    public {{main_class}}() {
        IEventBus modEventBus = FMLJavaModLoadingContext.get().getModEventBus();
        ModBlocks.BLOCKS.register(modEventBus);
        ModItems.ITEMS.register(modEventBus);
        modEventBus.addListener(ModItems::addCreative);
        LOGGER.info("Initialized {}", MOD_ID);
    }
}
